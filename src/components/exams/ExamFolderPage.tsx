"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { courseTitle, rpc, useExamSession, utcDate } from "@/lib/exams/client";
import { title } from "@/lib/exams/bank";
import type { ExamStatus, FolderExams } from "@/lib/exams/builder";
import { cn } from "@/lib/utils";
import { ExamShell, Notice, Spinner, type ExamLabels } from "./ExamShell";

export const statusClass = (s: ExamStatus) =>
  ({ DRAFT: "bg-sky-50 text-navy", PENDING_APPROVAL: "bg-gold/10 text-gold-600", PUBLISHED: "bg-emerald-50 text-emerald-700", STOPPED: "bg-mist text-slate", ARCHIVED: "bg-mist text-slate" })[s];

/** /[locale]/exams/folder?id=… — exams of a Domain Tests / Exam Simulations folder */
export function ExamFolderPage(props: { locale: string; labels: ExamLabels; homeLabel: string }) {
  return (
    <Suspense fallback={<Spinner />}>
      <Inner {...props} />
    </Suspense>
  );
}

function Inner({ locale, labels, homeLabel }: { locale: string; labels: ExamLabels; homeLabel: string }) {
  const id = useSearchParams().get("id") ?? "";
  const { state, reload } = useExamSession(locale);
  const [data, setData] = useState<FolderExams | null>(null);
  const [failed, setFailed] = useState(false);
  const bl = labels.builder;
  const ar = locale === "ar";

  useEffect(() => {
    if (state.status !== "ready" || !id) return;
    rpc<FolderExams>("exam_folder_exams", { p_folder: id }).then(setData).catch(() => setFailed(true));
  }, [state.status, id]);

  const course = state.status === "ready" && data ? state.me.courses.find((c) => c.programId === data.folder.programId) : undefined;
  const folderName = data ? (ar ? data.folder.nameAr : data.folder.nameEn) : "";
  const staff = course && course.access !== "LEARNER";
  const fmt = (d: string | null) => (d ? utcDate(d)!.toLocaleString(ar ? "ar-LY" : "en-GB", { dateStyle: "medium", timeStyle: "short" }) : "");

  return (
    <ExamShell
      locale={locale}
      labels={labels}
      state={state}
      reload={reload}
      title={folderName || labels.title}
      text={course ? courseTitle(course, locale) : undefined}
      crumbs={[
        { href: `/${locale}`, label: homeLabel },
        { href: `/${locale}/exams`, label: labels.title },
        ...(course ? [{ href: `/${locale}/exams/course?id=${encodeURIComponent(course.programId)}`, label: course.code ?? courseTitle(course, locale) }] : []),
        ...(data?.parent ? [{ href: `/${locale}/exams/folder?id=${encodeURIComponent(data.parent.id)}`, label: ar ? data.parent.nameAr : data.parent.nameEn }] : []),
        { label: folderName || "…" },
      ]}
    >
      {() =>
        failed ? (
          <Notice tone="error">{labels.course.notFound}</Notice>
        ) : !data ? (
          <Spinner />
        ) : (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Link href={data.parent ? `/${locale}/exams/folder?id=${encodeURIComponent(data.parent.id)}` : `/${locale}/exams/course?id=${encodeURIComponent(data.folder.programId)}`} className="text-sm font-semibold text-brand hover:underline">
                {ar ? "→" : "←"} {data.parent ? (ar ? data.parent.nameAr : data.parent.nameEn) : labels.bank.back}
              </Link>
              {data.canEdit && (
                <Link href={`/${locale}/exams/exam?folder=${encodeURIComponent(data.folder.id)}`} className="btn btn-primary btn-sm">
                  + {bl.newExam}
                </Link>
              )}
            </div>
            {!!data.folders?.length && (
              <section aria-label={bl.subFolders}>
                <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {data.folders.map((f) => (
                    <li key={f.id}>
                      <Link href={`/${locale}/exams/folder?id=${encodeURIComponent(f.id)}`} className={cn("card flex h-full items-center gap-3 p-5 transition hover:border-brand", f.status !== "ACTIVE" && "opacity-60")}>
                        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-brand/10 text-brand">
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5" aria-hidden="true">
                            <path d="M3 7h6l2 2h10v10H3z" />
                          </svg>
                        </span>
                        <span className="min-w-0">
                          <span className="block font-bold leading-snug text-navy">{ar ? f.nameAr : f.nameEn || f.nameAr}</span>
                          <span className="block text-sm text-slate">{f.count} {bl.exams}</span>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
                {data.exams.length > 0 && <h2 className="mt-8 text-xl font-bold">{bl.folderExams}</h2>}
              </section>
            )}
            {data.exams.length === 0 ? (
              data.folders?.length ? null : (
              <p className="rounded-2xl border border-dashed border-line bg-mist/60 px-6 py-10 text-center text-slate">{staff ? bl.noExams : bl.noPublished}</p>
              )
            ) : (
              <ul className="grid gap-4 md:grid-cols-2">
                {data.exams.map((e) => (
                  <li key={e.id} className={cn("card flex flex-col p-5", e.status === "ARCHIVED" && "opacity-60")}>
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="rounded-md bg-navy px-2 py-0.5 font-semibold text-white">{bl.types[e.examType]}</span>
                      {staff && <span className={cn("rounded-md px-2 py-0.5 font-semibold", statusClass(e.status))}>{bl.statuses[e.status]}</span>}
                    </div>
                    <h3 className="mt-3 text-lg font-bold text-navy">{title(e, locale)}</h3>
                    {(ar ? e.descAr : e.descEn) && <p className="mt-1 line-clamp-2 text-sm text-slate">{ar ? e.descAr || e.descEn : e.descEn || e.descAr}</p>}
                    <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                      <dt className="text-slate">{bl.questionCount}</dt>
                      <dd className="font-semibold text-navy">{e.questionCount}</dd>
                      <dt className="text-slate">{ar ? "المدة" : "Duration"}</dt>
                      <dd className="font-semibold text-navy">{e.durationMinutes ? `${e.durationMinutes} ${ar ? "دقيقة" : "min"}` : "—"}</dd>
                      <dt className="text-slate">{ar ? "المحاولات" : "Attempts"}</dt>
                      <dd className="font-semibold text-navy">{e.maxAttempts ?? "∞"}</dd>
                      <dt className="text-slate">{bl.passPercent}</dt>
                      <dd className="font-semibold text-navy">{Number(e.passPercent)}%</dd>
                      {e.startsAt && (<><dt className="text-slate">{bl.startsAt}</dt><dd className="text-navy">{fmt(e.startsAt)}</dd></>)}
                      {e.endsAt && (<><dt className="text-slate">{bl.endsAt}</dt><dd className="text-navy">{fmt(e.endsAt)}</dd></>)}
                    </dl>
                    <div className="mt-auto pt-4">
                      {staff ? (
                        <div className="flex flex-wrap gap-2">
                          <Link href={`/${locale}/exams/exam?id=${encodeURIComponent(e.id)}`} className="btn btn-outline btn-sm">{labels.bank.edit}</Link>
                          {e.status !== "DRAFT" && <Link href={`/${locale}/exams/attempts?id=${encodeURIComponent(e.id)}`} className="btn btn-outline btn-sm">{labels.staffAttempts.open}</Link>}
                          {e.status === "PUBLISHED" && <Link href={`/${locale}/exams/take?id=${encodeURIComponent(e.id)}`} className="btn btn-outline btn-sm">{labels.take.open}</Link>}
                        </div>
                      ) : (
                        <Link href={`/${locale}/exams/take?id=${encodeURIComponent(e.id)}`} className="btn btn-primary btn-sm">{labels.take.open}</Link>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )
      }
    </ExamShell>
  );
}
