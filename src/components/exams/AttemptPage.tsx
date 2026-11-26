"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useSearchParams } from "next/navigation";
import { ExamError, rpc, useExamSession, utcDate } from "@/lib/exams/client";
import { fmtClock, isAnswered, type AttemptState, type Response } from "@/lib/exams/attempt";
import { withBase } from "@/lib/env-public";
import { cn } from "@/lib/utils";
import { Notice, Spinner, type ExamLabels } from "./ExamShell";
import { AnswerInput, AttemptScenarioView, QuestionMedia } from "./AnswerInput";
import { Calculator, FloatingPanel, Whiteboard } from "./ExamTools";

const TEXT_TYPES = new Set(["SHORT", "ESSAY", "NUMERIC"]);

/** /[locale]/exams/attempt?id=… — taking the exam. The server owns time, answers and grading. */
export function AttemptPage(props: { locale: string; labels: ExamLabels; homeLabel?: string }) {
  return (
    <Suspense fallback={<Spinner />}>
      <Inner {...props} />
    </Suspense>
  );
}

function Inner({ locale, labels }: { locale: string; labels: ExamLabels }) {
  const id = useSearchParams().get("id") ?? "";
  const { state: session } = useExamSession(locale);
  const [st, setSt] = useState<AttemptState | null>(null);
  const [failed, setFailed] = useState(false);
  const at = labels.attempt;

  const toReview = useCallback(() => window.location.replace(withBase(`/${locale}/exams/review/?id=${encodeURIComponent(id)}`)), [locale, id]);

  useEffect(() => {
    if (session.status !== "ready" || !id) return;
    rpc<AttemptState>("exam_attempt_state", { p_attempt: id })
      .then((s) => (s.status === "IN_PROGRESS" ? setSt(s) : toReview()))
      .catch(() => setFailed(true));
  }, [session.status, id, toReview]);

  if (session.status === "server") return <div className="container-x py-12"><Notice>{labels.serverNotice}</Notice></div>;
  if (failed) return <div className="container-x py-12"><Notice tone="error">{labels.course.notFound}</Notice></div>;
  if (!st) return <Spinner />;
  return <Exam initial={st} locale={locale} labels={labels} onClosed={toReview} at={at} />;
}

function Exam({ initial, locale, labels, onClosed, at }: { initial: AttemptState; locale: string; labels: ExamLabels; onClosed: () => void; at: ExamLabels["attempt"] }) {
  const ar = locale === "ar";
  const qs = initial.questions;
  const [idx, setIdx] = useState(0);
  const [resp, setResp] = useState<Record<string, Response>>(() => Object.fromEntries(qs.map((q) => [q.id, q.response])));
  const [flags, setFlags] = useState<Record<string, boolean>>(() => Object.fromEntries(qs.map((q) => [q.id, q.flagged])));
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "offline">("idle");
  const [summary, setSummary] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [showCase, setShowCase] = useState(true);
  // phase 7: tools, English view, full screen, phone navigator
  const tl = labels.tools;
  const [cl, setCl] = useState<"ar" | "en">(ar ? "ar" : "en"); // language of the QUESTION CONTENT only
  const [calc, setCalc] = useState(false);
  const [board, setBoard] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const [fs, setFs] = useState(false);
  useEffect(() => {
    const on = () => setFs(!!document.fullscreenElement);
    on();
    document.addEventListener("fullscreenchange", on);
    return () => document.removeEventListener("fullscreenchange", on);
  }, []);
  const toggleFs = () => {
    const p = document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.();
    p?.catch(() => undefined);
  };
  // server clock: remaining = deadline − (client now + offset)
  const offset = useRef(utcDate(initial.serverNow)!.getTime() - Date.now());
  const deadline = initial.deadlineAt ? utcDate(initial.deadlineAt)!.getTime() : null;
  const [now, setNow] = useState(Date.now());
  const pending = useRef<Map<string, { response: Response; flagged: boolean }>>(new Map());
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const flushing = useRef(false);

  const flush = useCallback(async () => {
    if (flushing.current || pending.current.size === 0) return;
    flushing.current = true;
    setSaveState("saving");
    try {
      for (const [qid, v] of Array.from(pending.current.entries())) {
        try {
          await rpc("exam_attempt_save", { p_attempt: initial.id, p_question: qid, p_response: v.response, p_flagged: v.flagged });
          if (pending.current.get(qid) === v) pending.current.delete(qid);
        } catch (e) {
          if (e instanceof ExamError && e.code !== "network" && /attempt_closed/.test(e.message)) {
            pending.current.clear();
            onClosed();
            return;
          }
          if (e instanceof ExamError && e.code !== "network" && e.code !== "unknown") pending.current.delete(qid); // invalid answer: drop
          else throw e;
        }
      }
      setSaveState("saved");
    } catch {
      setSaveState("offline");
    } finally {
      flushing.current = false;
    }
  }, [initial.id, onClosed]);

  // retry while offline + clock tick
  useEffect(() => {
    const t = setInterval(() => {
      setNow(Date.now());
      if (pending.current.size && !flushing.current) flush();
    }, 1000);
    return () => clearInterval(t);
  }, [flush]);

  const queue = (qid: string, response: Response, flagged: boolean, debounce: boolean) => {
    pending.current.set(qid, { response, flagged });
    const old = timers.current.get(qid);
    if (old) clearTimeout(old);
    if (debounce) timers.current.set(qid, setTimeout(() => flush(), 700));
    else flush();
  };

  const submit = useCallback(async () => {
    setSubmitting(true);
    for (const t of Array.from(timers.current.values())) clearTimeout(t);
    await flush();
    try {
      await rpc("exam_attempt_submit", { p_attempt: initial.id });
    } catch {
      /* the server finalises on its own when time is over; the review page shows the outcome */
    }
    onClosed();
  }, [flush, initial.id, onClosed]);

  const remaining = deadline === null ? null : deadline - (now + offset.current);
  useEffect(() => {
    if (remaining !== null && remaining <= 0 && !submitting) submit();
  }, [remaining, submitting, submit]);

  const q = qs[idx];
  const scenario = q.data.scenarioId ? initial.scenarios[q.data.scenarioId] : undefined;
  const answered = qs.filter((x) => isAnswered(resp[x.id])).length;
  const flagged = qs.filter((x) => flags[x.id]).length;
  const low = remaining !== null && remaining < 5 * 60 * 1000;
  const side = scenario && scenario.displayMode !== "SECTION";

  // focused exam mode: a full-viewport layer above the site header/footer. Rendered into <body> through a
  // portal — the page wrapper has a CSS transform, which would otherwise trap "position: fixed" inside it.
  return createPortal(
    <div className="fixed inset-0 z-[60] overflow-y-auto bg-mist" dir={ar ? "rtl" : "ltr"}>
      {/* top bar */}
      <div className="sticky top-0 z-30 border-b border-line bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-[90rem] flex-wrap items-center gap-2 px-3 py-2.5 sm:gap-3 sm:px-5">
          <p className="min-w-0 flex-1 basis-full truncate font-bold text-navy sm:basis-auto">{ar ? initial.titleAr || initial.titleEn : initial.titleEn || initial.titleAr}</p>
          <div className="flex items-center gap-1.5">
            {initial.tools?.translation && (
              <button type="button" onClick={() => setCl(cl === "ar" ? "en" : "ar")} aria-pressed={cl === "en"} className={cn("rounded-lg px-2.5 py-1.5 text-sm font-semibold", cl === "en" ? "bg-brand text-white" : "bg-mist text-navy hover:bg-line")} lang={cl === "ar" ? "en" : "ar"}>
                {cl === "ar" ? tl.translate : tl.backToArabic}
              </button>
            )}
            {initial.tools?.calculator && (
              <button type="button" onClick={() => setCalc(!calc)} aria-pressed={calc} title={tl.calculator} aria-label={tl.calculator} className={cn("grid h-9 w-9 place-items-center rounded-lg", calc ? "bg-navy text-white" : "bg-mist text-navy hover:bg-line")}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-5 w-5" aria-hidden="true"><rect x="5" y="3" width="14" height="18" rx="2" /><path d="M8 7h8M8 12h.01M12 12h.01M16 12h.01M8 16h.01M12 16h.01M16 16h.01" /></svg>
              </button>
            )}
            {initial.tools?.whiteboard && (
              <button type="button" onClick={() => setBoard(!board)} aria-pressed={board} title={tl.whiteboard} aria-label={tl.whiteboard} className={cn("grid h-9 w-9 place-items-center rounded-lg", board ? "bg-navy text-white" : "bg-mist text-navy hover:bg-line")}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-5 w-5" aria-hidden="true"><path d="M3 5h18v11H3zM8 21l4-5 4 5M15 9l-3 3-2-2-3 3" /></svg>
              </button>
            )}
            <button type="button" onClick={toggleFs} title={fs ? tl.exitFullscreen : tl.fullscreen} aria-label={fs ? tl.exitFullscreen : tl.fullscreen} className="hidden h-9 w-9 place-items-center rounded-lg bg-mist text-navy hover:bg-line sm:grid">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-5 w-5" aria-hidden="true">{fs ? <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" /> : <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />}</svg>
            </button>
          </div>
          <span className={cn("text-xs", saveState === "offline" ? "font-semibold text-gold-600" : "text-slate")} role="status" aria-live="polite">
            {saveState === "saving" ? at.saving : saveState === "saved" ? at.saved : saveState === "offline" ? at.offline : ""}
          </span>
          <button type="button" onClick={() => setNavOpen(true)} className="rounded-lg bg-mist px-2.5 py-1.5 text-sm font-semibold text-navy lg:hidden">{tl.menu} {answered}/{qs.length}</button>
          <span className={cn("rounded-lg px-3 py-1.5 font-mono text-lg font-bold tabular-nums", low ? "bg-gold/10 text-gold-600" : "bg-navy text-white")} aria-label={at.timeLeft} dir="ltr">
            {remaining === null ? at.noLimit : fmtClock(remaining)}
          </span>
          <button type="button" onClick={() => setSummary(true)} className="btn btn-gold btn-sm">{at.finish}</button>
        </div>
      </div>

      {submitting && <div className="mx-auto max-w-[90rem] px-3 pt-4 sm:px-5"><Notice>{at.timeUp}</Notice></div>}

      <div className="mx-auto grid max-w-[90rem] gap-5 px-3 py-4 sm:px-5 sm:py-6 lg:grid-cols-[1fr_17rem]">
        <div className="space-y-4">
          {scenario && !side && (
            <div className="rounded-2xl border border-brand/20 bg-white p-5">
              <AttemptScenarioView s={scenario} locale={cl} labels={labels} />
            </div>
          )}
          <div className={side ? "grid gap-4 xl:grid-cols-2" : ""}>
            {scenario && side && (
              <div className="rounded-2xl border border-brand/20 bg-white p-5 xl:max-h-[75vh] xl:overflow-y-auto">
                <button type="button" onClick={() => setShowCase(!showCase)} className="mb-2 text-sm font-semibold text-brand xl:hidden">{showCase ? at.hideCase : at.showCase}</button>
                <div className={showCase ? "" : "hidden xl:block"}><AttemptScenarioView s={scenario} locale={cl} labels={labels} /></div>
              </div>
            )}
            <div className="rounded-2xl border border-line bg-white p-5 sm:p-6">
              <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-slate">
                <span>{at.question} <b className="text-navy">{idx + 1}</b> {at.of} {qs.length}</span>
                <span dir="ltr">{Number(q.points)} pt</span>
              </div>
              {cl === "en" && <p className="mt-2 rounded-lg bg-brand/5 px-3 py-1.5 text-xs text-brand">{q.data.stemEn ? tl.translatedNote : tl.noEnglish}</p>}
              <p className="mt-3 whitespace-pre-line text-[17px] font-semibold leading-8 text-navy" dir={cl === "en" && q.data.stemEn ? "ltr" : "rtl"} lang={cl === "en" && q.data.stemEn ? "en" : "ar"}>{cl === "ar" ? q.data.stemAr || q.data.stemEn : q.data.stemEn || q.data.stemAr}</p>
              <QuestionMedia assets={q.data.images} locale={cl} />
              <div className="mt-5" dir={cl === "en" && q.data.stemEn ? "ltr" : undefined}>
                <AnswerInput
                  key={q.id}
                  data={q.data}
                  value={resp[q.id]}
                  locale={cl}
                  labels={labels}
                  disabled={submitting}
                  onChange={(r) => {
                    setResp((cur) => ({ ...cur, [q.id]: r }));
                    queue(q.id, r, !!flags[q.id], TEXT_TYPES.has(q.data.type));
                  }}
                />
              </div>
              <div className="mt-6 flex flex-wrap items-center gap-2 border-t border-line pt-4">
                <button type="button" onClick={() => setIdx(Math.max(0, idx - 1))} disabled={idx === 0} className="btn btn-outline btn-sm">{ar ? "→" : "←"} {at.prev}</button>
                <button
                  type="button"
                  onClick={() => {
                    const v = !flags[q.id];
                    setFlags((cur) => ({ ...cur, [q.id]: v }));
                    queue(q.id, resp[q.id], v, false);
                  }}
                  className={cn("btn btn-sm", flags[q.id] ? "btn-gold" : "btn-outline")}
                  aria-pressed={!!flags[q.id]}
                >
                  ⚑ {flags[q.id] ? at.unmark : at.mark}
                </button>
                <button type="button" onClick={() => (idx < qs.length - 1 ? setIdx(idx + 1) : setSummary(true))} className="btn btn-primary btn-sm ms-auto">
                  {idx < qs.length - 1 ? `${at.next} ${ar ? "←" : "→"}` : at.finish}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* navigator */}
        {navOpen && <button type="button" aria-label={tl.close} onClick={() => setNavOpen(false)} className="fixed inset-0 z-40 bg-navy/40 lg:hidden" />}
        <aside className={cn("h-fit rounded-2xl border border-line bg-white p-4 lg:sticky lg:top-20 lg:block", navOpen ? "fixed inset-x-0 bottom-0 z-50 max-h-[70vh] overflow-y-auto rounded-b-none shadow-2xl" : "hidden")}>
          <p className="mb-3 font-semibold text-navy">{at.navigator}</p>
          <div className="grid grid-cols-6 gap-1.5 sm:grid-cols-10 lg:grid-cols-5">
            {qs.map((x, i) => (
              <button
                key={x.id}
                type="button"
                onClick={() => { setIdx(i); setNavOpen(false); }}
                aria-current={i === idx}
                aria-label={`${at.question} ${i + 1}`}
                className={cn(
                  "relative h-9 rounded-lg text-sm font-semibold transition",
                  isAnswered(resp[x.id]) ? "bg-navy text-white" : "bg-mist text-slate hover:bg-line",
                  i === idx && "ring-2 ring-brand ring-offset-1",
                )}
              >
                {i + 1}
                {flags[x.id] && <span className="absolute -end-1 -top-1 h-3 w-3 rounded-full border-2 border-white bg-gold" aria-hidden="true" />}
              </button>
            ))}
          </div>
          <ul className="mt-4 space-y-1 text-xs text-slate">
            <li className="flex items-center gap-2"><span className="h-3 w-3 rounded bg-navy" /> {at.answered}: {answered}</li>
            <li className="flex items-center gap-2"><span className="h-3 w-3 rounded bg-mist ring-1 ring-line" /> {at.unanswered}: {qs.length - answered}</li>
            <li className="flex items-center gap-2"><span className="h-3 w-3 rounded-full bg-gold" /> {at.flagged}: {flagged}</li>
          </ul>
        </aside>
      </div>

      {calc && (
        <FloatingPanel title={tl.calculator} onClose={() => setCalc(false)} start={{ x: 24, y: 90 }} width={300} closeLabel={tl.close}>
          <Calculator labels={labels} />
        </FloatingPanel>
      )}
      {board && (
        <FloatingPanel title={tl.whiteboard} onClose={() => setBoard(false)} start={{ x: 340, y: 80 }} width={760} closeLabel={tl.close}>
          <div className="h-[62vh]"><Whiteboard storageKey={`exam-wb:${initial.id}`} labels={labels} /></div>
        </FloatingPanel>
      )}

      {/* summary before submitting */}
      {summary && (
        <div className="fixed inset-0 z-[90] grid place-items-center bg-navy/60 p-4" role="dialog" aria-modal="true" aria-labelledby="sum-title">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <h2 id="sum-title" className="text-xl font-bold text-navy">{at.summaryTitle}</h2>
            <dl className="mt-4 grid grid-cols-2 gap-y-2 text-sm">
              <dt className="text-slate">{at.answered}</dt><dd className="font-bold text-navy">{answered} / {qs.length}</dd>
              <dt className="text-slate">{at.unanswered}</dt><dd className="font-bold text-navy">{qs.length - answered}</dd>
              <dt className="text-slate">{at.flagged}</dt><dd className="font-bold text-navy">{flagged}</dd>
              <dt className="text-slate">{at.remaining}</dt><dd className="font-bold text-navy" dir="ltr">{remaining === null ? at.noLimit : fmtClock(remaining)}</dd>
            </dl>
            {(qs.length - answered > 0 || flagged > 0) && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {qs.map((x, i) => (!isAnswered(resp[x.id]) || flags[x.id]) && (
                  <button key={x.id} type="button" onClick={() => { setIdx(i); setSummary(false); }} className={cn("h-8 min-w-8 rounded-md px-2 text-xs font-semibold", flags[x.id] ? "bg-gold/15 text-gold-600" : "bg-mist text-slate")}>{i + 1}</button>
                ))}
              </div>
            )}
            <p className="mt-4 text-sm text-slate">{at.submitWarning}</p>
            <div className="mt-5 flex flex-wrap gap-3">
              <button type="button" onClick={submit} disabled={submitting} className="btn btn-primary">{at.confirmSubmit}</button>
              <button type="button" onClick={() => setSummary(false)} className="btn btn-outline">{at.backToExam}</button>
            </div>
          </div>
        </div>
      )}
    </div>,
    document.body,
  );
}
