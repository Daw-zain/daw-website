"use client";

import Link from "next/link";
import { courseTitle, isPlatformAdmin, useExamSession } from "@/lib/exams/client";
import { EmptyState } from "@/components/ui";
import { ExamShell, type ExamLabels } from "./ExamShell";

/** /[locale]/exams — the courses the signed-in member can open, by role */
export function ExamsHome({ locale, labels, homeLabel }: { locale: string; labels: ExamLabels; homeLabel: string }) {
  const { state, reload } = useExamSession(locale);
  return (
    <ExamShell
      locale={locale}
      labels={labels}
      state={state}
      reload={reload}
      title={labels.title}
      text={labels.intro}
      crumbs={[{ href: `/${locale}`, label: homeLabel }, { label: labels.title }]}
    >
      {(me) => (
        <>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <h2 className="text-2xl font-bold">{labels.myCourses}</h2>
            <div className="flex flex-wrap gap-2">
              <Link href={`/${locale}/exams/analytics`} className="btn btn-outline btn-sm">
                {labels.analytics.openMine}
              </Link>
              {isPlatformAdmin(me) && (
                <Link href={`/${locale}/manage`} className="btn btn-primary btn-sm">
                  {labels.manage.open}
                </Link>
              )}
            </div>
          </div>
          {me.courses.length === 0 ? (
            <div className="mt-6">
              <EmptyState text={me.role === "LEARNER" ? labels.noCourses : labels.noCoursesStaff} />
            </div>
          ) : (
            <ul className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {me.courses.map((c) => (
                <li key={c.programId}>
                  <Link
                    href={`/${locale}/exams/course?id=${encodeURIComponent(c.programId)}`}
                    className="card card-hover group flex h-full flex-col p-6"
                  >
                    <div className="flex items-start justify-between gap-3">
                      {c.code && <span className="rounded-lg bg-navy px-2.5 py-1 text-xs font-bold tracking-wide text-white" dir="ltr">{c.code}</span>}
                      <span className="rounded-full bg-mist px-2.5 py-1 text-xs font-semibold text-slate">{c.viaRole ? labels.access.STAFF : labels.access[c.access]}</span>
                    </div>
                    <h3 className="mt-4 text-lg font-bold leading-snug text-navy group-hover:text-brand">{courseTitle(c, locale)}</h3>
                    <span className="mt-auto pt-5 text-sm font-semibold text-brand">
                      {labels.openCourse} {locale === "ar" ? "←" : "→"}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </ExamShell>
  );
}
