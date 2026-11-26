"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ExamError, rpc, useExamSession, utcDate } from "@/lib/exams/client";
import { title } from "@/lib/exams/bank";
import type { AttemptStatus, PublicQuestion, ReviewQuestion } from "@/lib/exams/attempt";
import { cn } from "@/lib/utils";
import { ExamShell, Notice, Spinner, type ExamLabels } from "./ExamShell";
import { answerText } from "./AttemptReviewPage";

type Row = { id: string; attemptNo: number; status: AttemptStatus; name: string; email: string; memberId: string; startedAt: string; submittedAt: string | null; score: number | null; maxScore: number | null; percent: number | null; passed: boolean | null; answeredCount: number; questionCount: number; needsManual: boolean; warnings: number };
type List = { exam: { id: string; titleAr: string; titleEn: string; programId: string; folderId: string; resultsPolicy: string; resultsReleasedAt: string | null }; can: { grade: boolean; reopen: boolean; release: boolean }; attempts: Row[] };
type DetailQ = { id: string; position: number; type: string; points: number; data: PublicQuestion; response: ReviewQuestion["response"]; flagged: boolean; score: number | null; manualScore: number | null; isCorrect: boolean | null; graderComment: string; answer: ReviewQuestion["answer"]; rubricAr: string | null };
type Detail = Row & { questions: DetailQ[]; staffNote: string; reviewFlag?: boolean };
type ProctorEventRow = { kind: string; counted: boolean; detail: string; at: string };

/** /[locale]/exams/attempts?id=<examId> — attempts and results for staff (needs canViewResults; enforced in the database) */
export function StaffAttemptsPage(props: { locale: string; labels: ExamLabels; homeLabel: string }) {
  return (
    <Suspense fallback={<Spinner />}>
      <Inner {...props} />
    </Suspense>
  );
}

function Inner({ locale, labels, homeLabel }: { locale: string; labels: ExamLabels; homeLabel: string }) {
  const id = useSearchParams().get("id") ?? "";
  const { state, reload } = useExamSession(locale);
  const [list, setList] = useState<List | null>(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState<Detail | null>(null);
  const [flash, setFlash] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const sa = labels.staffAttempts;
  const ar = locale === "ar";
  const fmt = (d: string | null) => (d ? utcDate(d)!.toLocaleString(ar ? "ar-LY" : "en-GB", { dateStyle: "short", timeStyle: "short" }) : "—");

  const load = useCallback(() => rpc<List>("exam_exam_attempts", { p_exam: id }).then(setList).catch(() => setFailed(true)), [id]);
  useEffect(() => {
    if (state.status === "ready" && id) load();
  }, [state.status, id, load]);

  const act = async (fn: () => Promise<unknown>, after?: (r: unknown) => void) => {
    setFlash(null);
    try {
      const r = await fn();
      after?.(r);
      setFlash({ tone: "success", text: sa.done });
      await load();
    } catch (e) {
      setFlash({ tone: "error", text: e instanceof ExamError && e.code === "forbidden" ? labels.admin.errors.forbidden : labels.errorGeneric });
    }
  };
  const openDetail = (aid: string) => rpc<Detail>("exam_attempt_detail", { p_attempt: aid }).then(setOpen).catch(() => setFlash({ tone: "error", text: labels.errorGeneric }));

  return (
    <ExamShell
      locale={locale}
      labels={labels}
      state={state}
      reload={reload}
      title={sa.title}
      text={list ? title(list.exam, locale) : undefined}
      crumbs={[{ href: `/${locale}`, label: homeLabel }, { href: `/${locale}/exams`, label: labels.title }, ...(list ? [{ href: `/${locale}/exams/exam?id=${encodeURIComponent(list.exam.id)}`, label: title(list.exam, locale) }] : []), { label: sa.title }]}
    >
      {() =>
        failed ? <Notice tone="error">{labels.admin.errors.forbidden}</Notice> : !list ? <Spinner /> : (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-3">
              <Link href={`/${locale}/exams/exam?id=${encodeURIComponent(list.exam.id)}`} className="text-sm font-semibold text-brand hover:underline">{ar ? "→" : "←"} {labels.builder.titleEdit}</Link>
              {list.exam.resultsPolicy === "MANUAL" && list.can.release && (
                list.exam.resultsReleasedAt ? <span className="ms-auto rounded-md bg-emerald-50 px-2.5 py-1 text-sm font-semibold text-emerald-700">{sa.released}</span>
                  : <button type="button" onClick={() => act(() => rpc("exam_exam_release_results", { p_exam: list.exam.id }))} className="btn btn-primary btn-sm ms-auto">{sa.release}</button>
              )}
            </div>
            {flash && <Notice tone={flash.tone}>{flash.text}</Notice>}

            {list.attempts.length === 0 ? <p className="rounded-2xl border border-dashed border-line bg-mist/60 px-6 py-10 text-center text-slate">{sa.none}</p> : (
              <div className="overflow-x-auto rounded-2xl border border-line bg-white">
                <table className="w-full min-w-[640px] text-sm">
                  <thead className="bg-mist text-start text-slate">
                    <tr>
                      <th className="px-4 py-2.5 text-start font-semibold">{sa.learner}</th>
                      <th className="px-4 py-2.5 text-start font-semibold">#</th>
                      <th className="px-4 py-2.5 text-start font-semibold">{sa.started}</th>
                      <th className="px-4 py-2.5 text-start font-semibold">{labels.take.statuses.COMPLETED}</th>
                      <th className="px-4 py-2.5 text-start font-semibold">{sa.result}</th>
                      <th className="px-4 py-2.5" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {list.attempts.map((a) => (
                      <tr key={a.id} className={cn(a.status === "CANCELLED" && "opacity-60")}>
                        <td className="px-4 py-2.5"><span className="block font-semibold text-navy">{a.name}</span><span className="text-xs text-slate" dir="ltr">{a.email}</span></td>
                        <td className="px-4 py-2.5">{a.attemptNo}</td>
                        <td className="px-4 py-2.5 text-slate">{fmt(a.startedAt)}</td>
                        <td className="px-4 py-2.5">{labels.take.statuses[a.status]}{a.needsManual && <span className="ms-1 rounded bg-gold/10 px-1.5 py-0.5 text-xs font-semibold text-gold-600">{sa.needsGrading}</span>}</td>
                        <td className="px-4 py-2.5" dir="ltr">{a.score !== null ? `${Number(a.score)}/${Number(a.maxScore)} · ${Number(a.percent)}%` : "—"}{a.passed !== null && <span className={cn("ms-1", a.passed ? "text-emerald-700" : "text-gold-600")}>{a.passed ? "✓" : "✗"}</span>}</td>
                        <td className="px-4 py-2.5 text-end"><button type="button" onClick={() => openDetail(a.id)} className="btn btn-outline btn-sm">{sa.view}</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {open && <DetailPanel d={open} can={list.can} examId={list.exam.id} locale={locale} labels={labels} onClose={() => setOpen(null)} onAct={(fn) => act(fn, (r) => r && typeof r === "object" && "questions" in (r as object) && setOpen(r as Detail))} />}
          </div>
        )
      }
    </ExamShell>
  );
}

function DetailPanel({ d, can, examId, locale, labels, onClose, onAct }: { d: Detail; can: List["can"]; examId: string; locale: string; labels: ExamLabels; onClose: () => void; onAct: (fn: () => Promise<unknown>) => void }) {
  const sa = labels.staffAttempts;
  const ar = locale === "ar";
  const [grades, setGrades] = useState<Record<string, { score: string; comment: string }>>(() =>
    Object.fromEntries(d.questions.filter((q) => q.type === "ESSAY").map((q) => [q.id, { score: q.manualScore !== null ? String(q.manualScore) : "", comment: q.graderComment }])),
  );
  const [minutes, setMinutes] = useState("15");
  const [note, setNote] = useState("");
  const pr = labels.proctor;
  const [events, setEvents] = useState<ProctorEventRow[] | null>(null);
  const [reviewNote, setReviewNote] = useState("");
  useEffect(() => {
    rpc<ProctorEventRow[]>("exam_attempt_events", { p_attempt: d.id }).then(setEvents).catch(() => setEvents([]));
  }, [d.id, d.status]);
  return (
    <section className="card space-y-4 p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-bold text-navy">{d.name} · {labels.take.attemptNo} {d.attemptNo} · {labels.take.statuses[d.status]}</h2>
        <button type="button" onClick={onClose} className="btn btn-outline btn-sm">{sa.close}</button>
      </div>
      {d.status === "UNDER_REVIEW" && can.reopen && (
        <div className="flex flex-wrap items-end gap-2 rounded-xl border border-gold/40 bg-gold/5 p-3 text-sm">
          <span className="font-semibold text-gold-600">{pr.held}</span>
          <input value={reviewNote} onChange={(e) => setReviewNote(e.target.value)} placeholder={pr.releaseNote} className="field w-56 py-1.5" />
          <button type="button" onClick={() => onAct(() => rpc("exam_attempt_clear_review", { p_attempt: d.id, p_note: reviewNote }))} className="btn btn-primary btn-sm">{pr.release}</button>
        </div>
      )}
      <div className="rounded-xl border border-line p-3 text-sm">
        <p className="font-semibold text-navy">{pr.eventsTitle} · {pr.warnings}: {d.warnings}</p>
        {events === null ? null : events.length === 0 ? <p className="mt-1 text-slate">{pr.noEvents}</p> : (
          <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto">
            {events.map((ev, i) => (
              <li key={i} className="flex flex-wrap gap-2">
                <span className="text-slate" dir="ltr">{utcDate(ev.at)!.toLocaleTimeString(ar ? "ar-LY" : "en-GB")}</span>
                <span className={ev.counted ? "font-semibold text-gold-600" : "text-ink"}>{(pr.events as Record<string, string>)[ev.kind] ?? ev.kind}</span>
                {ev.counted && <span className="rounded bg-gold/10 px-1.5 text-xs text-gold-600">{pr.counted}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>
      {can.reopen && (
        <div className="flex flex-wrap items-end gap-2 rounded-xl bg-mist p-3 text-sm">
          {d.status !== "IN_PROGRESS" && d.status !== "CANCELLED" && (
            <>
              <label><span className="field-label">{sa.reopenMinutes}</span><input type="number" min={1} max={600} value={minutes} onChange={(e) => setMinutes(e.target.value)} className="field w-24 py-1.5" dir="ltr" /></label>
              <button type="button" onClick={() => onAct(() => rpc("exam_attempt_reopen", { p_attempt: d.id, p_minutes: Number(minutes) }))} className="btn btn-outline btn-sm">{sa.reopen}</button>
            </>
          )}
          <button type="button" onClick={() => onAct(() => rpc("exam_grant_attempt", { p_exam: examId, p_member: d.memberId, p_extra: 1 }))} className="btn btn-outline btn-sm">{sa.grant}</button>
          {d.status !== "CANCELLED" && (
            <>
              <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={sa.cancelNote} className="field w-48 py-1.5" />
              <button type="button" onClick={() => window.confirm(sa.confirmCancel) && onAct(() => rpc("exam_attempt_cancel", { p_attempt: d.id, p_note: note }))} className="rounded-lg px-3 py-1.5 text-gold-600 hover:bg-gold/10">{sa.cancel}</button>
            </>
          )}
        </div>
      )}
      <ol className="space-y-3">
        {d.questions.map((q) => {
          const shown = q.manualScore ?? q.score;
          return (
            <li key={q.id} className="rounded-xl border border-line p-4">
              <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span className="text-slate">{q.position}. {labels.bank.types[q.type as keyof typeof labels.bank.types]}{q.flagged ? " ⚑" : ""}</span>
                <span className="font-semibold" dir="ltr">{shown === null ? "…" : `${Number(shown)} / ${Number(q.points)}`}</span>
              </div>
              <p className="mt-1 font-semibold leading-7 text-navy">{ar ? q.data.stemAr || q.data.stemEn : q.data.stemEn || q.data.stemAr}</p>
              <p className="mt-2 text-sm"><b className="text-slate">{sa.response}:</b> <span className="whitespace-pre-line">{answerText(q, q.response, locale, labels) || "—"}</span></p>
              {q.type !== "ESSAY" && <p className="text-sm"><b className="text-emerald-700">{sa.correctAnswer}:</b> {answerText(q, q.answer, locale, labels)}</p>}
              {q.type === "ESSAY" && (
                <div className="mt-3 space-y-2 rounded-lg bg-mist p-3 text-sm">
                  {q.rubricAr && <p className="text-slate">{q.rubricAr}</p>}
                  {can.grade && d.status !== "IN_PROGRESS" && d.status !== "CANCELLED" ? (
                    <div className="flex flex-wrap items-end gap-2">
                      <label><span className="field-label">{sa.gradeLabel} (≤ {Number(q.points)})</span><input type="number" min={0} max={Number(q.points)} step={0.25} value={grades[q.id]?.score ?? ""} onChange={(e) => setGrades({ ...grades, [q.id]: { ...grades[q.id], score: e.target.value } })} className="field w-28 py-1.5" dir="ltr" /></label>
                      <input value={grades[q.id]?.comment ?? ""} onChange={(e) => setGrades({ ...grades, [q.id]: { ...grades[q.id], comment: e.target.value } })} placeholder={sa.comment} className="field min-w-0 flex-1 py-1.5" />
                      <button type="button" disabled={grades[q.id]?.score === ""} onClick={() => onAct(() => rpc("exam_attempt_grade", { p_question: q.id, p_score: Number(grades[q.id].score), p_comment: grades[q.id].comment }))} className="btn btn-primary btn-sm">{sa.grade}</button>
                    </div>
                  ) : q.graderComment && <p>{q.graderComment}</p>}
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
