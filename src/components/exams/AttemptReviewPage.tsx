"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { rpc, useExamSession } from "@/lib/exams/client";
import { title } from "@/lib/exams/bank";
import { txt, type AttemptReview, type ReviewQuestion } from "@/lib/exams/attempt";
import { cn } from "@/lib/utils";
import { ExamShell, Notice, Spinner, type ExamLabels } from "./ExamShell";
import { AttemptScenarioView, QuestionMedia } from "./AnswerInput";
import { HotspotAnswer } from "./AdvancedQuestions";

/** /[locale]/exams/review?id=… — result and (if the exam allows) question-by-question review */
export function AttemptReviewPage(props: { locale: string; labels: ExamLabels; homeLabel: string }) {
  return (
    <Suspense fallback={<Spinner />}>
      <Inner {...props} />
    </Suspense>
  );
}

function Inner({ locale, labels, homeLabel }: { locale: string; labels: ExamLabels; homeLabel: string }) {
  const id = useSearchParams().get("id") ?? "";
  const { state, reload } = useExamSession(locale);
  const [rv, setRv] = useState<AttemptReview | null>(null);
  const [failed, setFailed] = useState(false);
  const r = labels.review;

  useEffect(() => {
    if (state.status !== "ready" || !id) return;
    rpc<AttemptReview>("exam_attempt_review", { p_attempt: id }).then(setRv).catch(() => setFailed(true));
  }, [state.status, id]);

  return (
    <ExamShell
      locale={locale}
      labels={labels}
      state={state}
      reload={reload}
      title={r.title}
      text={rv ? `${title(rv, locale)} · ${labels.take.attemptNo} ${rv.attemptNo}` : undefined}
      crumbs={[{ href: `/${locale}`, label: homeLabel }, { href: `/${locale}/exams`, label: labels.title }, ...(rv ? [{ href: `/${locale}/exams/take?id=${encodeURIComponent(rv.examId)}`, label: title(rv, locale) }] : []), { label: r.title }]}
    >
      {() =>
        failed ? <Notice tone="error">{labels.course.notFound}</Notice> : !rv ? <Spinner /> : (
          <div className="space-y-6">
            <div className="card p-6">
              <p className="text-sm text-slate">{labels.take.statuses[rv.status]}</p>
              {rv.resultsVisible ? (
                <>
                  <div className="mt-3 flex flex-wrap items-end gap-x-8 gap-y-3">
                    <div><p className="text-sm text-slate">{r.score}</p><p className="text-3xl font-extrabold text-navy" dir="ltr">{Number(rv.score)} / {Number(rv.maxScore)}</p></div>
                    <div><p className="text-sm text-slate">{r.percent}</p><p className="text-3xl font-extrabold text-navy" dir="ltr">{Number(rv.percent)}%</p></div>
                    <div><p className="text-sm text-slate">{r.passMark}</p><p className="text-xl font-bold text-navy" dir="ltr">{Number(rv.passPercent)}%</p></div>
                    {rv.passed !== null && <span className={cn("rounded-xl px-4 py-2 text-lg font-bold", rv.passed ? "bg-emerald-50 text-emerald-700" : "bg-gold/10 text-gold-600")}>{rv.passed ? r.passed : r.failed}</span>}
                  </div>
                  <p className="mt-3 text-sm text-slate">{r.answered}: {rv.answeredCount} / {rv.questionCount} · {r.correctCount}: {rv.correctCount ?? "—"}</p>
                  {rv.needsManual && <div className="mt-4"><Notice>{r.pendingManual}</Notice></div>}
                </>
              ) : <div className="mt-3"><Notice>{r.hidden}</Notice></div>}
              <Link href={`/${locale}/exams/take?id=${encodeURIComponent(rv.examId)}`} className="btn btn-outline btn-sm mt-5">{r.backToExam}</Link>
            </div>

            {rv.resultsVisible && !rv.reviewVisible && <Notice>{r.noReview}</Notice>}
            {rv.reviewVisible && (
              <ol className="space-y-5">
                {rv.questions.map((q, i) => {
                  const scn = q.data.scenarioId ? rv.scenarios[q.data.scenarioId] : undefined;
                  const firstOfScn = scn && rv.questions.findIndex((x) => x.data.scenarioId === q.data.scenarioId) === i;
                  return (
                    <li key={q.id} className="space-y-3">
                      {firstOfScn && <div className="rounded-2xl border border-brand/20 bg-white p-5"><AttemptScenarioView s={scn!} locale={locale} labels={labels} /></div>}
                      <ReviewCard q={q} n={i + 1} total={rv.questions.length} locale={locale} labels={labels} />
                    </li>
                  );
                })}
              </ol>
            )}
          </div>
        )
      }
    </ExamShell>
  );
}

/** human-readable answer (learner's or correct) for one question */
export function answerText(q: { data: ReviewQuestion["data"] }, a: ReviewQuestion["response"] | ReviewQuestion["answer"], locale: string, labels: ExamLabels): string {
  if (!a) return "";
  const d = q.data;
  const opt = (id: string) => txt([...(d.options ?? []), ...(d.items ?? []), ...(d.right ?? [])].find((o) => o.id === id), locale);
  const resp = a as Record<string, unknown>;
  switch (d.type) {
    case "MCQ":
      return resp.choice ? opt(String(resp.choice)) : ((resp.correct as string[]) ?? []).map(opt).join("، ");
    case "MULTI":
      return ((resp.choices as string[]) ?? (resp.correct as string[]) ?? []).map(opt).join(" · ");
    case "TRUE_FALSE":
      return resp.value === true ? labels.bank.editor.tfTrue : resp.value === false ? labels.bank.editor.tfFalse : "";
    case "NUMERIC":
      return resp.value !== undefined ? `${resp.value}${resp.tolerance ? ` ± ${resp.tolerance}` : ""}` : "";
    case "SHORT":
      return String(resp.text ?? ((resp.accepted as string[]) ?? []).join(" / "));
    case "ESSAY":
      return String(resp.text ?? resp.rubricAr ?? "");
    case "ORDERING":
      return ((resp.order as string[]) ?? []).map((id, i) => `${i + 1}. ${opt(id)}`).join("  ");
    case "MATCHING":
      return (d.left ?? []).map((l) => `${txt(l, locale)} ← ${opt((resp.pairs as Record<string, string>)?.[l.id] ?? "") || "—"}`).join("  ·  ");
    // ── phase 10 ──
    case "HOTSPOT": {
      const n = ((resp.points ?? resp.regions) as unknown[] | undefined)?.length ?? 0;
      return n ? (resp.points ? labels.review.marksN : labels.review.areasN).replace("{n}", String(n)) : "";
    }
    case "DRAGDROP": {
      const place = (resp.place ?? resp.placements ?? {}) as Record<string, string>;
      const item = (id: string) => txt((d.items ?? []).find((o) => o.id === id), locale);
      return (d.zones ?? [])
        .map((z) => {
          const inside = Object.entries(place).filter(([, zone]) => zone === z.id).map(([it]) => item(it));
          return inside.length ? `${txt(z, locale)}: ${inside.join("، ")}` : "";
        })
        .filter(Boolean)
        .join("  ·  ");
    }
    case "CLOZE": {
      const vals = (resp.blanks ?? {}) as Record<string, string | { correct?: string; accepted?: string[] }>;
      return (d.blanks ?? [])
        .map((b) => {
          const v = vals[b.id];
          if (v === undefined || v === "") return `[${b.id}] —`;
          if (typeof v === "string") return `[${b.id}] ${b.kind === "SELECT" ? txt((b.options ?? []).find((o) => o.id === v), locale) : v}`;
          return `[${b.id}] ${v.correct ? txt((b.options ?? []).find((o) => o.id === v.correct), locale) : (v.accepted ?? []).join(" / ")}`;
        })
        .join("   ");
    }
  }
  return "";
}

function ReviewCard({ q, n, total, locale, labels }: { q: ReviewQuestion; n: number; total: number; locale: string; labels: ExamLabels }) {
  const r = labels.review;
  const ar = locale === "ar";
  const full = q.score !== null && Number(q.score) >= Number(q.points);
  const part = q.score !== null && Number(q.score) > 0 && !full;
  const tone = q.score === null ? "border-line" : full ? "border-emerald-300" : part ? "border-gold/50" : "border-gold/40";
  const fb = ar ? q.feedbackAr || q.feedbackEn : q.feedbackEn || q.feedbackAr;
  const ex = ar ? q.explanationAr || q.explanationEn : q.explanationEn || q.explanationAr;
  const rationales = Object.entries(q.optionRationale ?? {}).filter(([, v]) => v && (v.ar || v.en));
  return (
    <div className={cn("rounded-2xl border-2 bg-white p-5", tone)}>
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <span className="text-slate">{labels.attempt.question} {n} / {total}</span>
        <span className={cn("rounded-md px-2 py-0.5 font-semibold", q.score === null ? "bg-mist text-slate" : full ? "bg-emerald-50 text-emerald-700" : part ? "bg-gold/10 text-gold-600" : "bg-gold/10 text-gold-600")} dir="ltr">
          {q.score === null ? "…" : `${Number(q.score)} / ${Number(q.points)}`}
        </span>
      </div>
      <p className="mt-2 whitespace-pre-line font-semibold leading-8 text-navy">{ar ? q.data.stemAr || q.data.stemEn : q.data.stemEn || q.data.stemAr}</p>
      <QuestionMedia assets={q.data.images} figure={q.data.figure} locale={locale} labels={labels} />
      {q.data.type === "HOTSPOT" && <div className="mt-3"><HotspotAnswer data={q.data} response={q.response} regions={q.answer?.regions} labels={labels} /></div>}
      <dl className="mt-3 space-y-2 text-sm leading-7">
        <div><dt className="font-semibold text-slate">{r.yourAnswer}</dt><dd className="whitespace-pre-line text-ink">{answerText(q, q.response, locale, labels) || <span className="text-slate">{r.notAnswered}</span>}</dd></div>
        {q.answer && q.data.type !== "ESSAY" && <div><dt className="font-semibold text-emerald-700">{r.correctAnswer}</dt><dd className="text-ink">{answerText(q, q.answer, locale, labels)}</dd></div>}
      </dl>
      {q.graderComment && <p className="mt-3 rounded-lg bg-mist px-3 py-2 text-sm"><b>{r.graderComment}:</b> {q.graderComment}</p>}
      {fb && <div className="mt-3 border-t border-line pt-3 text-sm"><p className="font-semibold text-navy">{r.feedback}</p><p className="whitespace-pre-line">{fb}</p></div>}
      {ex && <div className="mt-3 border-t border-line pt-3 text-sm"><p className="font-semibold text-navy">{r.explanation}</p><p className="whitespace-pre-line">{ex}</p></div>}
      {rationales.length > 0 && (
        <ul className="mt-2 space-y-1 text-sm">
          {rationales.map(([id, v]) => <li key={id}><b>{txt((q.data.options ?? []).find((o) => o.id === id), locale) || id}:</b> {ar ? v.ar || v.en : v.en || v.ar}</li>)}
        </ul>
      )}
      {q.reference && <p className="mt-2 text-xs text-slate">{r.reference}: {q.reference}</p>}
    </div>
  );
}
