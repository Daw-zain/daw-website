"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { courseTitle, ExamError, rpc, useExamSession, utcDate, type ExamCourse } from "@/lib/exams/client";
import { fmtClock, isAnswered, txt, type Response } from "@/lib/exams/attempt";
import { QUESTION_TYPES } from "@/lib/exams/bank";
import { MISTAKE_STATUSES, type MistakeDetail, type MistakeSession, type MistakesOverview, type MistakesReport, type MistakeStatus, type Reveal } from "@/lib/exams/mistakes";
import { cn } from "@/lib/utils";
import { ExamShell, Notice, Spinner, type ExamLabels } from "./ExamShell";
import { AnswerInput, AttemptScenarioView, QuestionMedia } from "./AnswerInput";
import { answerText } from "./AttemptReviewPage";

/** /[locale]/exams/mistakes?id=<programId> — my mistakes, review sessions, and (staff) the course report */
export function ExamMistakesPage(props: { locale: string; labels: ExamLabels; homeLabel: string }) {
  return (
    <Suspense fallback={<Spinner />}>
      <Inner {...props} />
    </Suspense>
  );
}

const STATUS_TONE: Record<MistakeStatus, string> = {
  WRONG_NOT_REVIEWED: "bg-gold/10 text-gold-600",
  REVIEWED: "bg-mist text-navy",
  CORRECT_IN_REVIEW: "bg-brand/10 text-brand",
  WRONG_AGAIN: "bg-gold/15 text-gold-600",
  MASTERED: "bg-emerald-50 text-emerald-700",
};

function Inner({ locale, labels, homeLabel }: { locale: string; labels: ExamLabels; homeLabel: string }) {
  const programId = useSearchParams().get("id") ?? "";
  const { state, reload } = useExamSession(locale);
  const mk = labels.mistakes;
  const course = state.status === "ready" ? state.me.courses.find((c) => c.programId === programId) : undefined;
  const staff = !!course && (course.access === "ADMIN" || (course.access === "INSTRUCTOR" && !!course.permissions?.canViewResults));
  const [tab, setTab] = useState<"mine" | "report">("mine");
  const [session, setSession] = useState<string | null>(null);

  return (
    <ExamShell
      locale={locale}
      labels={labels}
      state={state}
      reload={reload}
      title={mk.title}
      text={course ? courseTitle(course, locale) : undefined}
      crumbs={[
        { href: `/${locale}`, label: homeLabel },
        { href: `/${locale}/exams`, label: labels.title },
        ...(course ? [{ href: `/${locale}/exams/course?id=${encodeURIComponent(programId)}`, label: course.code ?? courseTitle(course, locale) }] : []),
        { label: mk.title },
      ]}
    >
      {() =>
        !course ? <Notice tone="error">{labels.course.notFound}</Notice> : session ? (
          <SessionView id={session} locale={locale} labels={labels} onClose={() => setSession(null)} />
        ) : (
          <div className="space-y-6">
            {staff && (
              <div className="flex gap-2" role="tablist">
                {(["mine", "report"] as const).map((t) => (
                  <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={cn("btn btn-sm", tab === t ? "btn-primary" : "btn-outline")}>
                    {t === "mine" ? mk.tabMine : mk.tabReport}
                  </button>
                ))}
              </div>
            )}
            {tab === "report" && staff ? <Report programId={programId} locale={locale} labels={labels} /> : <Mine course={course} locale={locale} labels={labels} onSession={setSession} />}
          </div>
        )
      }
    </ExamShell>
  );
}

// ── my mistakes ──

type Filter = { status: string; domainId: string; difficulty: string; type: string };
const NO_FILTER: Filter = { status: "", domainId: "", difficulty: "", type: "" };

function Mine({ course, locale, labels, onSession }: { course: ExamCourse; locale: string; labels: ExamLabels; onSession: (id: string) => void }) {
  const mk = labels.mistakes;
  const ar = locale === "ar";
  const [filter, setFilter] = useState<Filter>(NO_FILTER);
  const [data, setData] = useState<MistakesOverview | null>(null);
  const [failed, setFailed] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [opts, setOpts] = useState({ count: 10, random: true, minutes: "", feedbackMode: "AFTER_ANSWER", includeMastered: false });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fmt = (d: string | null) => (d ? utcDate(d)!.toLocaleDateString(ar ? "ar-LY" : "en-GB", { dateStyle: "medium" }) : "—");

  const load = useCallback(() => {
    rpc<MistakesOverview>("exam_mistakes_overview", { p_program: course.programId, p_filter: filter }).then(setData).catch(() => setFailed(true));
  }, [course.programId, filter]);
  useEffect(load, [load]);

  const start = async (extra: Record<string, unknown> = {}) => {
    setBusy(true);
    setErr(null);
    try {
      const statuses = filter.status ? [filter.status] : MISTAKE_STATUSES.filter((s) => opts.includeMastered || s !== "MASTERED");
      const r = await rpc<{ sessionId: string }>("exam_mistakes_start", {
        p_program: course.programId,
        p_filter: { ...filter, statuses, count: opts.count, random: opts.random, minutes: opts.minutes ? Number(opts.minutes) : null, feedbackMode: opts.feedbackMode, ...extra },
      });
      onSession(r.sessionId);
    } catch (e) {
      setErr(e instanceof ExamError && /no_mistakes/.test(e.message) ? mk.noMistakes : labels.errorGeneric);
      setBusy(false);
    }
  };

  if (failed) return <Notice tone="error">{labels.errorGeneric}</Notice>;
  if (!data) return <Spinner />;
  const c = data.counts;
  const pct = c.total ? Math.round((100 * c.mastered) / c.total) : 0;
  const sel = "mt-1 w-full rounded-lg border border-line bg-white px-3 py-2 text-sm";

  return (
    <div className="space-y-6">
      <p className="max-w-3xl leading-7 text-slate">{mk.intro}</p>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {([
          [mk.total, c.total],
          [mk.statuses.WRONG_NOT_REVIEWED, c.notReviewed],
          [mk.statuses.REVIEWED, c.reviewed],
          [mk.statuses.CORRECT_IN_REVIEW, c.correctInReview],
          [mk.statuses.WRONG_AGAIN, c.wrongAgain],
          [mk.mastered, c.mastered],
        ] as const).map(([k, v]) => (
          <div key={k} className="card p-4">
            <p className="text-xs text-slate">{k}</p>
            <p className="text-2xl font-bold text-navy">{v}</p>
          </div>
        ))}
      </div>
      <div className="card p-5">
        <div className="flex items-center justify-between text-sm">
          <span className="font-semibold text-navy">{mk.progress}</span>
          <span className="font-bold text-navy" dir="ltr">{pct}%</span>
        </div>
        <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-mist"><div className="h-full rounded-full bg-emerald-500" style={{ width: `${pct}%` }} /></div>
        <p className="mt-2 text-xs text-slate">{mk.masteryRule.replace("{n}", String(data.masteryStreak))}</p>
        {data.byDomain.length > 1 && (
          <ul className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
            {data.byDomain.map((d) => (
              <li key={d.domainId ?? "-"} className="flex justify-between gap-2 rounded-lg bg-mist px-3 py-1.5">
                <span className="truncate">{d.name ?? mk.noDomain}</span>
                <span dir="ltr">{d.mastered} / {d.total}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {data.openSession && (
        <Notice>
          <button type="button" onClick={() => onSession(data.openSession!)} className="btn btn-primary btn-sm">{mk.resume}</button>
        </Notice>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-4">
          <div className="card grid gap-3 p-4 sm:grid-cols-4">
            <label className="text-xs font-semibold text-slate">{mk.filterStatus}
              <select className={sel} value={filter.status} onChange={(e) => setFilter({ ...filter, status: e.target.value })}>
                <option value="">{mk.all}</option>
                {MISTAKE_STATUSES.map((s) => <option key={s} value={s}>{mk.statuses[s]}</option>)}
              </select>
            </label>
            <label className="text-xs font-semibold text-slate">{mk.filterDomain}
              <select className={sel} value={filter.domainId} onChange={(e) => setFilter({ ...filter, domainId: e.target.value })}>
                <option value="">{mk.all}</option>
                {data.byDomain.filter((d) => d.domainId).map((d) => <option key={d.domainId} value={d.domainId!}>{d.name}</option>)}
              </select>
            </label>
            <label className="text-xs font-semibold text-slate">{mk.filterDifficulty}
              <select className={sel} value={filter.difficulty} onChange={(e) => setFilter({ ...filter, difficulty: e.target.value })}>
                <option value="">{mk.all}</option>
                {(["EASY", "MEDIUM", "HARD"] as const).map((d) => <option key={d} value={d}>{mk.difficulties[d]}</option>)}
              </select>
            </label>
            <label className="text-xs font-semibold text-slate">{mk.filterType}
              <select className={sel} value={filter.type} onChange={(e) => setFilter({ ...filter, type: e.target.value })}>
                <option value="">{mk.all}</option>
                {QUESTION_TYPES.map((t) => <option key={t} value={t}>{labels.bank.types[t]}</option>)}
              </select>
            </label>
          </div>

          {data.items.length === 0 ? (
            <Notice>{c.total === 0 ? mk.empty : mk.emptyFilter}</Notice>
          ) : (
            <ul className="space-y-3">
              {data.items.map((m) => (
                <li key={m.id} className="card p-4">
                  <div className="flex flex-wrap items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="line-clamp-2 font-semibold leading-7 text-navy">{ar ? m.stemAr || m.stemEn : m.stemEn || m.stemAr}</p>
                      <p className="mt-1 text-xs text-slate">
                        {labels.bank.types[m.type]}{m.domain ? ` · ${m.domain}` : ""}{m.topic ? ` · ${m.topic}` : ""} · {mk.wrongTimes}: {m.wrongCount} · {mk.reviewStats}: ✓{m.reviewCorrect} ✗{m.reviewWrong} · {mk.lastWrong}: {fmt(m.lastWrongAt)}
                      </p>
                    </div>
                    <span className={cn("rounded-md px-2 py-0.5 text-xs font-semibold", STATUS_TONE[m.status])}>{mk.statuses[m.status]}</span>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button type="button" onClick={() => setOpenId(openId === m.id ? null : m.id)} className="btn btn-outline btn-sm">{openId === m.id ? mk.hide : mk.details}</button>
                    <button type="button" disabled={busy || !!data.openSession} onClick={() => start({ ids: [m.id], count: 1 })} className="btn btn-outline btn-sm">{mk.practiceOne}</button>
                  </div>
                  {openId === m.id && <Detail id={m.id} locale={locale} labels={labels} onSeen={load} />}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="card h-fit space-y-3 p-5">
          <h2 className="text-lg font-bold text-navy">{mk.startTitle}</h2>
          <p className="text-xs text-slate">{mk.startHint}</p>
          <label className="block text-xs font-semibold text-slate">{mk.count}
            <select className={sel} value={opts.count} onChange={(e) => setOpts({ ...opts, count: Number(e.target.value) })}>
              {[5, 10, 20, 50, 100].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          <label className="block text-xs font-semibold text-slate">{mk.timer}
            <input type="number" min={1} max={300} inputMode="numeric" className={sel} value={opts.minutes} onChange={(e) => setOpts({ ...opts, minutes: e.target.value })} />
          </label>
          <label className="block text-xs font-semibold text-slate">{mk.feedbackMode}
            <select className={sel} value={opts.feedbackMode} onChange={(e) => setOpts({ ...opts, feedbackMode: e.target.value })}>
              {(["AFTER_ANSWER", "AFTER_SESSION"] as const).map((f) => <option key={f} value={f}>{mk.feedbackModes[f]}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm text-navy">
            <input type="checkbox" checked={opts.random} onChange={(e) => setOpts({ ...opts, random: e.target.checked })} className="h-4 w-4 accent-[var(--color-brand)]" /> {mk.random}
          </label>
          <label className="flex items-center gap-2 text-sm text-navy">
            <input type="checkbox" checked={opts.includeMastered} onChange={(e) => setOpts({ ...opts, includeMastered: e.target.checked })} className="h-4 w-4 accent-[var(--color-brand)]" /> {mk.includeMastered}
          </label>
          <button type="button" disabled={busy || c.total === 0 || !!data.openSession} onClick={() => start()} className="btn btn-primary w-full">{busy ? labels.loading : mk.start}</button>
          {err && <Notice tone="error">{err}</Notice>}
        </div>
      </div>
    </div>
  );
}

function RevealView({ q, reveal, locale, labels }: { q: { data: MistakeDetail["data"] }; reveal: Reveal | null; locale: string; labels: ExamLabels }) {
  const r = labels.review;
  const mk = labels.mistakes;
  const ar = locale === "ar";
  if (!reveal || Object.keys(reveal).length === 0) return <p className="mt-3 rounded-lg bg-mist px-3 py-2 text-sm text-slate">{mk.noReveal}</p>;
  const fb = ar ? reveal.feedbackAr || reveal.feedbackEn : reveal.feedbackEn || reveal.feedbackAr;
  const ex = ar ? reveal.explanationAr || reveal.explanationEn : reveal.explanationEn || reveal.explanationAr;
  const rationales = Object.entries(reveal.optionRationale ?? {}).filter(([, v]) => v && (v.ar || v.en));
  return (
    <div className="mt-3 space-y-3 text-sm leading-7">
      {reveal.answer && (q.data.type === "ESSAY"
        ? reveal.answer.rubricAr && <div><p className="font-semibold text-emerald-700">{mk.guide}</p><p className="whitespace-pre-line">{reveal.answer.rubricAr}</p></div>
        : <div><p className="font-semibold text-emerald-700">{r.correctAnswer}</p><p>{answerText(q, reveal.answer, locale, labels)}</p></div>)}
      {fb && <div className="border-t border-line pt-3"><p className="font-semibold text-navy">{r.feedback}</p><p className="whitespace-pre-line">{fb}</p></div>}
      {ex && <div className="border-t border-line pt-3"><p className="font-semibold text-navy">{r.explanation}</p><p className="whitespace-pre-line">{ex}</p></div>}
      {rationales.length > 0 && (
        <ul className="space-y-1">
          {rationales.map(([id, v]) => <li key={id}><b>{txt((q.data.options ?? []).find((o) => o.id === id), locale) || id}:</b> {ar ? v.ar || v.en : v.en || v.ar}</li>)}
        </ul>
      )}
      {reveal.reference && <p className="text-xs text-slate">{r.reference}: {reveal.reference}</p>}
    </div>
  );
}

function Detail({ id, locale, labels, onSeen }: { id: string; locale: string; labels: ExamLabels; onSeen: () => void }) {
  const mk = labels.mistakes;
  const ar = locale === "ar";
  const [d, setD] = useState<MistakeDetail | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    rpc<MistakeDetail>("exam_mistake_detail", { p_id: id })
      .then((x) => {
        setD(x);
        if (x.history.filter((h) => h.kind === "VIEWED").length === 1 && x.status === "REVIEWED") onSeen();
      })
      .catch(() => setFailed(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load once per opened item
  }, [id]);
  if (failed) return <div className="mt-3"><Notice tone="error">{labels.errorGeneric}</Notice></div>;
  if (!d) return <Spinner />;
  return (
    <div className="mt-4 border-t border-line pt-4">
      {d.scenario && <div className="mb-3 rounded-2xl border border-brand/20 bg-white p-4"><AttemptScenarioView s={d.scenario} locale={locale} labels={labels} /></div>}
      <p className="whitespace-pre-line font-semibold leading-8 text-navy">{ar ? d.data.stemAr || d.data.stemEn : d.data.stemEn || d.data.stemAr}</p>
      <QuestionMedia assets={d.data.images} locale={locale} />
      <div className="mt-3 text-sm leading-7">
        <p className="font-semibold text-gold-600">{mk.yourLastAnswer}</p>
        <p className="whitespace-pre-line">{answerText(d, d.lastResponse, locale, labels) || "—"}</p>
      </div>
      <RevealView q={d} reveal={d.reveal} locale={locale} labels={labels} />
      <p className="mt-3 text-xs text-slate">
        {mk.history}: {d.history.map((h) => `${(mk.historyKinds as Record<string, string>)[h.kind] ?? h.kind} (${utcDate(h.at)!.toLocaleDateString(ar ? "ar-LY" : "en-GB")})`).join(" ← ")}
      </p>
    </div>
  );
}

// ── review session ──

function SessionView({ id, locale, labels, onClose }: { id: string; locale: string; labels: ExamLabels; onClose: () => void }) {
  const mk = labels.mistakes;
  const ar = locale === "ar";
  const [s, setS] = useState<MistakeSession | null>(null);
  const [failed, setFailed] = useState(false);
  const [idx, setIdx] = useState(0);
  const [draft, setDraft] = useState<Record<string, Response>>({});
  const [busy, setBusy] = useState(false);
  const [offset, setOffset] = useState(0);
  const [now, setNow] = useState(Date.now());

  const load = useCallback(async () => {
    try {
      const x = await rpc<MistakeSession>("exam_mistakes_state", { p_session: id });
      setOffset(utcDate(x.serverNow)!.getTime() - Date.now());
      setS(x);
    } catch {
      setFailed(true);
    }
  }, [id]);
  useEffect(() => {
    load();
  }, [load]);

  const deadline = s?.deadlineAt ? utcDate(s.deadlineAt)!.getTime() : null;
  const left = deadline !== null ? deadline - (now + offset) : null;
  useEffect(() => {
    if (!s || s.status !== "IN_PROGRESS" || deadline === null) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [s, deadline]);
  useEffect(() => {
    if (left !== null && left <= 0 && s?.status === "IN_PROGRESS") load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload once when the clock reaches zero
  }, [left !== null && left <= 0]);

  if (failed) return <Notice tone="error">{labels.errorGeneric}</Notice>;
  if (!s) return <Spinner />;

  const answer = async (qid: string) => {
    setBusy(true);
    try {
      await rpc("exam_mistakes_answer", { p_session: id, p_question: qid, p_response: draft[qid] });
    } catch {
      /* closed by the timer, already answered … — the reloaded state shows the truth */
    }
    await load();
    setBusy(false);
  };
  const finish = async () => {
    if (!window.confirm(mk.finishConfirm)) return;
    setBusy(true);
    try {
      setS(await rpc<MistakeSession>("exam_mistakes_submit", { p_session: id }));
    } catch {
      await load();
    }
    setBusy(false);
  };

  const done = s.status === "COMPLETED";
  const answeredN = s.questions.filter((q) => isAnswered(q.response)).length;

  if (done) {
    return (
      <div className="space-y-5">
        <div className="card p-6">
          <h2 className="text-lg font-bold text-navy">{mk.result}</h2>
          {deadline !== null && answeredN < s.questionCount && <p className="mt-1 text-sm text-slate">{mk.timeUp}</p>}
          <p className="mt-2 text-3xl font-bold text-navy" dir="ltr">{s.correctCount} / {s.questionCount}</p>
          <button type="button" onClick={onClose} className="btn btn-primary btn-sm mt-4">{mk.backToList}</button>
        </div>
        <ol className="space-y-4">
          {s.questions.map((q, i) => <SessionCard key={q.id} q={q} n={i + 1} total={s.questionCount} locale={locale} labels={labels} showReveal />)}
        </ol>
      </div>
    );
  }

  const q = s.questions[Math.min(idx, s.questions.length - 1)];
  const answered = isAnswered(q.response);
  return (
    <div className="space-y-5">
      <div className="card flex flex-wrap items-center gap-3 p-4">
        <h2 className="flex-1 font-bold text-navy">{mk.sessionTitle}</h2>
        <span className="text-sm text-slate">{answeredN} / {s.questionCount}</span>
        {left !== null && <span className={cn("rounded-md px-2 py-1 font-mono text-sm font-bold", left < 60000 ? "bg-gold/15 text-gold-600" : "bg-mist text-navy")} dir="ltr" aria-label={mk.timeLeft}>{fmtClock(Math.max(left, 0))}</span>}
        <button type="button" disabled={busy} onClick={finish} className="btn btn-outline btn-sm">{mk.finish}</button>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {s.questions.map((x, i) => (
          <button key={x.id} type="button" onClick={() => setIdx(i)} className={cn("h-8 w-8 rounded-lg text-xs font-semibold",
            i === idx ? "bg-navy text-white" : x.isCorrect === true ? "bg-emerald-50 text-emerald-700" : x.isCorrect === false ? "bg-gold/15 text-gold-600" : isAnswered(x.response) ? "bg-brand/10 text-brand" : "bg-mist text-navy")}>
            {i + 1}
          </button>
        ))}
      </div>
      {answered ? (
        <SessionCard q={q} n={idx + 1} total={s.questionCount} locale={locale} labels={labels} showReveal={s.feedbackMode === "AFTER_ANSWER"} />
      ) : (
        <div className="rounded-2xl border-2 border-line bg-white p-5">
          <p className="text-sm text-slate">{labels.attempt.question} {idx + 1} / {s.questionCount}</p>
          {q.data.scenario && <div className="my-3 rounded-2xl border border-brand/20 bg-white p-4"><AttemptScenarioView s={q.data.scenario} locale={locale} labels={labels} /></div>}
          <p className="mt-2 whitespace-pre-line font-semibold leading-8 text-navy">{ar ? q.data.stemAr || q.data.stemEn : q.data.stemEn || q.data.stemAr}</p>
          <QuestionMedia assets={q.data.images} locale={locale} />
          <div className="mt-4">
            <AnswerInput data={q.data} value={draft[q.id] ?? null} onChange={(r) => setDraft({ ...draft, [q.id]: r })} locale={locale} labels={labels} disabled={busy} />
          </div>
          <button type="button" disabled={busy || !isAnswered(draft[q.id] ?? null)} onClick={() => answer(q.id)} className="btn btn-primary btn-sm mt-4">{mk.check}</button>
        </div>
      )}
      <div className="flex justify-between">
        <button type="button" disabled={idx === 0} onClick={() => setIdx(idx - 1)} className="btn btn-outline btn-sm">{labels.attempt.prev}</button>
        {idx < s.questions.length - 1 ? (
          <button type="button" onClick={() => setIdx(idx + 1)} className="btn btn-outline btn-sm">{labels.attempt.next}</button>
        ) : (
          <button type="button" disabled={busy} onClick={finish} className="btn btn-primary btn-sm">{mk.finish}</button>
        )}
      </div>
    </div>
  );
}

function SessionCard({ q, n, total, locale, labels, showReveal }: { q: MistakeSession["questions"][number]; n: number; total: number; locale: string; labels: ExamLabels; showReveal: boolean }) {
  const mk = labels.mistakes;
  const ar = locale === "ar";
  const essay = q.data.type === "ESSAY";
  return (
    <li className={cn("list-none rounded-2xl border-2 bg-white p-5", q.isCorrect === true ? "border-emerald-300" : q.isCorrect === false ? "border-gold/50" : "border-line")}>
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <span className="text-slate">{labels.attempt.question} {n} / {total}</span>
        {showReveal && isAnswered(q.response) && (
          <span className={cn("rounded-md px-2 py-0.5 font-semibold", essay ? "bg-mist text-slate" : q.isCorrect ? "bg-emerald-50 text-emerald-700" : "bg-gold/10 text-gold-600")}>
            {essay ? mk.guide : q.isCorrect ? mk.correct : mk.wrong}
          </span>
        )}
      </div>
      {q.data.scenario && <div className="my-3 rounded-2xl border border-brand/20 bg-white p-4"><AttemptScenarioView s={q.data.scenario} locale={locale} labels={labels} /></div>}
      <p className="mt-2 whitespace-pre-line font-semibold leading-8 text-navy">{ar ? q.data.stemAr || q.data.stemEn : q.data.stemEn || q.data.stemAr}</p>
      <QuestionMedia assets={q.data.images} locale={locale} />
      <div className="mt-3 text-sm leading-7">
        <p className="font-semibold text-slate">{labels.review.yourAnswer}</p>
        <p className="whitespace-pre-line">{answerText(q, q.response, locale, labels) || <span className="text-slate">{labels.review.notAnswered}</span>}</p>
      </div>
      {essay && showReveal && isAnswered(q.response) && <p className="mt-2 text-xs text-slate">{mk.selfCheck}</p>}
      {showReveal && isAnswered(q.response) && <RevealView q={q} reveal={q.reveal} locale={locale} labels={labels} />}
    </li>
  );
}

// ── staff report ──

function Report({ programId, locale, labels }: { programId: string; locale: string; labels: ExamLabels }) {
  const mk = labels.mistakes;
  const ar = locale === "ar";
  const [r, setR] = useState<MistakesReport | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    rpc<MistakesReport>("exam_mistakes_report", { p_program: programId }).then(setR).catch(() => setFailed(true));
  }, [programId]);
  if (failed) return <Notice tone="error">{labels.errorGeneric}</Notice>;
  if (!r) return <Spinner />;
  const th = "px-3 py-2 text-start text-xs font-semibold text-slate";
  const td = "px-3 py-2 text-sm";
  const empty = <p className="p-4 text-sm text-slate">{mk.reportEmpty}</p>;
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">{mk.reportTitle}</h2>
        <p className="mt-1 text-sm text-slate">{mk.reportIntro} {mk.masteryRule.replace("{n}", String(r.masteryStreak))}</p>
      </div>
      <div className="card overflow-x-auto">
        <h3 className="px-4 pt-4 font-bold text-navy">{mk.topQuestions}</h3>
        {r.questions.length === 0 ? empty : (
          <table className="mt-2 w-full">
            <thead><tr className="border-b border-line"><th className={th}>#</th><th className={th}>{labels.attempt.question}</th><th className={th}>{mk.filterDomain}</th><th className={th}>{mk.learners}</th><th className={th}>{mk.wrongs}</th><th className={th}>{mk.mastered}</th></tr></thead>
            <tbody className="divide-y divide-line">
              {r.questions.map((q, i) => (
                <tr key={q.questionId}>
                  <td className={td}>{i + 1}</td>
                  <td className={cn(td, "max-w-md")}><span className="line-clamp-2">{ar ? q.stemAr || q.stemEn : q.stemEn || q.stemAr}</span><span className="text-xs text-slate">{labels.bank.types[q.type]}</span></td>
                  <td className={td}>{q.domain ?? "—"}</td><td className={td}>{q.learners}</td><td className={cn(td, "font-bold")}>{q.wrongs}</td><td className={td}>{q.mastered}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="card overflow-x-auto">
          <h3 className="px-4 pt-4 font-bold text-navy">{mk.domains}</h3>
          {r.domains.length === 0 ? empty : (
            <table className="mt-2 w-full">
              <thead><tr className="border-b border-line"><th className={th}>{mk.filterDomain}</th><th className={th}>{mk.items}</th><th className={th}>{mk.wrongs}</th><th className={th}>{mk.mastered}</th></tr></thead>
              <tbody className="divide-y divide-line">{r.domains.map((d) => <tr key={d.domainId ?? "-"}><td className={td}>{d.name ?? mk.noDomain}</td><td className={td}>{d.items}</td><td className={td}>{d.wrongs}</td><td className={td}>{d.mastered}</td></tr>)}</tbody>
            </table>
          )}
        </div>
        <div className="card overflow-x-auto">
          <h3 className="px-4 pt-4 font-bold text-navy">{mk.topics}</h3>
          {r.topics.length === 0 ? empty : (
            <table className="mt-2 w-full">
              <thead><tr className="border-b border-line"><th className={th}>{mk.topics}</th><th className={th}>{mk.items}</th><th className={th}>{mk.wrongs}</th></tr></thead>
              <tbody className="divide-y divide-line">{r.topics.map((t) => <tr key={t.topicId}><td className={td}>{t.name ?? "—"}</td><td className={td}>{t.items}</td><td className={td}>{t.wrongs}</td></tr>)}</tbody>
            </table>
          )}
        </div>
      </div>
      <div className="card overflow-x-auto">
        <h3 className="px-4 pt-4 font-bold text-navy">{mk.learners}</h3>
        {r.learners.length === 0 ? empty : (
          <table className="mt-2 w-full">
            <thead><tr className="border-b border-line"><th className={th}>{mk.learner}</th><th className={th}>{mk.total}</th><th className={th}>{mk.mastered}</th><th className={th}>{mk.stillWrong}</th><th className={th}>{mk.wrongs}</th><th className={th}>{mk.reviewStats}</th></tr></thead>
            <tbody className="divide-y divide-line">
              {r.learners.map((l) => (
                <tr key={l.memberId}>
                  <td className={td}><span className="block font-semibold text-navy">{l.name}</span><span className="text-xs text-slate" dir="ltr">{l.email}</span></td>
                  <td className={td}>{l.total}</td><td className={td}>{l.mastered}</td><td className={td}>{l.stillWrong}</td><td className={td}>{l.wrongTotal}</td><td className={td} dir="ltr">✓{l.reviewCorrect} ✗{l.reviewWrong}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {r.exams.length > 0 && (
        <div className="card p-4">
          <h3 className="font-bold text-navy">{mk.exams}</h3>
          <ul className="mt-2 space-y-1 text-sm">{r.exams.map((e) => <li key={e.examId ?? "-"} className="flex justify-between gap-2"><span>{e.title ?? "—"}</span><span>{e.items}</span></li>)}</ul>
        </div>
      )}
      <p className="text-xs text-slate"><Link href={`/${locale}/exams/course?id=${encodeURIComponent(programId)}`} className="text-brand hover:underline">{labels.course.folders}</Link></p>
    </div>
  );
}
