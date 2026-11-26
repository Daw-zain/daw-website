"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { courseTitle, ExamError, rpc, useExamSession, utcDate } from "@/lib/exams/client";
import { title } from "@/lib/exams/bank";
import type { TakeInfo } from "@/lib/exams/attempt";
import { withBase } from "@/lib/env-public";
import { cn } from "@/lib/utils";
import { ExamShell, Notice, Spinner, type ExamLabels } from "./ExamShell";

/** /[locale]/exams/take?id=… — exam details, rules, start / resume, my attempts */
export function ExamTakePage(props: { locale: string; labels: ExamLabels; homeLabel: string }) {
  return (
    <Suspense fallback={<Spinner />}>
      <Inner {...props} />
    </Suspense>
  );
}

function Inner({ locale, labels, homeLabel }: { locale: string; labels: ExamLabels; homeLabel: string }) {
  const id = useSearchParams().get("id") ?? "";
  const { state, reload } = useExamSession(locale);
  const [info, setInfo] = useState<TakeInfo | null>(null);
  const [failed, setFailed] = useState(false);
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const tk = labels.take;
  const ar = locale === "ar";

  useEffect(() => {
    if (state.status !== "ready" || !id) return;
    rpc<TakeInfo>("exam_take_info", { p_exam: id }).then(setInfo).catch(() => setFailed(true));
  }, [state.status, id]);

  const course = state.status === "ready" && info ? state.me.courses.find((c) => c.programId === info.programId) : undefined;
  const fmt = (d: string | null) => (d ? utcDate(d)!.toLocaleString(ar ? "ar-LY" : "en-GB", { dateStyle: "medium", timeStyle: "short" }) : "");
  const go = (attemptId: string) => window.location.assign(withBase(`/${locale}/exams/attempt/?id=${encodeURIComponent(attemptId)}`));

  const start = async () => {
    setBusy(true);
    setErr(null);
    try {
      if (info?.security?.fullscreen && document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen().catch(() => undefined);
      const r = await rpc<{ attemptId: string }>("exam_attempt_start", { p_exam: id });
      go(r.attemptId);
    } catch (e) {
      const m = e instanceof ExamError ? e.message : "";
      const reason = m.match(/cannot_start: (\w+)/)?.[1];
      setErr(reason ? (tk.reasons as Record<string, string>)[reason] ?? labels.errorGeneric : labels.errorGeneric);
      setBusy(false);
    }
  };

  return (
    <ExamShell
      locale={locale}
      labels={labels}
      state={state}
      reload={reload}
      title={info ? title(info, locale) : labels.title}
      text={course ? courseTitle(course, locale) : undefined}
      crumbs={[
        { href: `/${locale}`, label: homeLabel },
        { href: `/${locale}/exams`, label: labels.title },
        ...(course ? [{ href: `/${locale}/exams/course?id=${encodeURIComponent(course.programId)}`, label: course.code ?? courseTitle(course, locale) }] : []),
        ...(info ? [{ href: `/${locale}/exams/folder?id=${encodeURIComponent(info.folderId)}`, label: labels.builder.backFolder }] : []),
        { label: info ? title(info, locale) : "…" },
      ]}
    >
      {() =>
        failed ? <Notice tone="error">{labels.course.notFound}</Notice> : !info ? <Spinner /> : (
          <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
            <div className="space-y-6">
              <div className="card p-6">
                {(ar ? info.descAr || info.descEn : info.descEn || info.descAr) && <p className="mb-4 whitespace-pre-line leading-7 text-ink">{ar ? info.descAr || info.descEn : info.descEn || info.descAr}</p>}
                <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
                  <div><dt className="text-slate">{tk.questions}</dt><dd className="text-lg font-bold text-navy">{info.questionCount}</dd></div>
                  <div><dt className="text-slate">{tk.duration}</dt><dd className="text-lg font-bold text-navy">{info.durationMinutes ? `${info.durationMinutes} ${tk.minutes}` : tk.untimed}</dd></div>
                  <div><dt className="text-slate">{tk.passMark}</dt><dd className="text-lg font-bold text-navy">{Number(info.passPercent)}%</dd></div>
                  <div><dt className="text-slate">{tk.attempts}</dt><dd className="text-lg font-bold text-navy">{info.attemptsUsed} / {info.attemptsAllowed ?? "∞"}</dd></div>
                  {info.startsAt && <div><dt className="text-slate">{tk.opens}</dt><dd className="font-semibold text-navy">{fmt(info.startsAt)}</dd></div>}
                  {info.endsAt && <div><dt className="text-slate">{tk.closes}</dt><dd className="font-semibold text-navy">{fmt(info.endsAt)}</dd></div>}
                </dl>
                {(info.tools.calculator || info.tools.whiteboard || info.tools.translation) && (
                  <p className="mt-4 text-sm text-slate">
                    {tk.tools}: {(["calculator", "whiteboard", "translation"] as const).filter((k) => info.tools[k]).map((k) => tk.toolNames[k]).join(" · ")}
                  </p>
                )}
              </div>

              <div className="card p-6">
                <h2 className="text-lg font-bold text-navy">{tk.rulesTitle}</h2>
                <ul className="mt-3 list-inside list-disc space-y-1.5 text-sm leading-7 text-ink">
                  {tk.rules.map((r) => <li key={r}>{r}</li>)}
                  {info.security?.fullscreen && <li>{tk.fullscreenRule}</li>}
                </ul>
                {info.openAttemptId ? (
                  <button type="button" onClick={() => go(info.openAttemptId!)} className="btn btn-primary mt-5">{tk.resume}</button>
                ) : info.canStart ? (
                  <>
                    <label className="mt-5 flex items-center gap-2 text-sm font-semibold text-navy">
                      <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} className="h-4 w-4 accent-[var(--color-brand)]" />
                      {tk.agree}
                    </label>
                    <button type="button" onClick={start} disabled={!agree || busy} className="btn btn-primary mt-4">{busy ? labels.loading : tk.start}</button>
                  </>
                ) : (
                  <div className="mt-5"><Notice>{(tk.reasons as Record<string, string>)[info.reason ?? ""] ?? labels.errorGeneric}</Notice></div>
                )}
                {err && <div className="mt-4"><Notice tone="error">{err}</Notice></div>}
              </div>
            </div>

            <div className="card h-fit p-6">
              <h2 className="text-lg font-bold text-navy">{tk.myAttempts}</h2>
              {info.attempts.length === 0 ? <p className="mt-3 text-sm text-slate">—</p> : (
                <ul className="mt-3 divide-y divide-line">
                  {info.attempts.map((a) => (
                    <li key={a.id} className="space-y-1 py-3 text-sm">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-navy">{tk.attemptNo} {a.attemptNo}</span>
                        <span className="text-xs text-slate">{fmt(a.startedAt)}</span>
                      </div>
                      <p className="text-slate">{tk.statuses[a.status]}</p>
                      {a.resultsVisible && a.score !== null ? (
                        <p>
                          <span className="font-bold text-navy" dir="ltr">{Number(a.score)} / {Number(a.maxScore)} · {Number(a.percent)}%</span>{" "}
                          {a.passed !== null && <span className={cn("ms-1 rounded-md px-2 py-0.5 text-xs font-semibold", a.passed ? "bg-emerald-50 text-emerald-700" : "bg-gold/10 text-gold-600")}>{a.passed ? tk.passed : tk.failed}</span>}
                        </p>
                      ) : a.status !== "IN_PROGRESS" && a.status !== "CANCELLED" ? <p className="text-xs text-slate">{tk.pending}</p> : null}
                      {a.status !== "IN_PROGRESS" && a.status !== "CANCELLED" && (
                        <Link href={`/${locale}/exams/review?id=${encodeURIComponent(a.id)}`} className="inline-block font-semibold text-brand hover:underline">
                          {a.reviewVisible ? tk.review : tk.results}
                        </Link>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )
      }
    </ExamShell>
  );
}
