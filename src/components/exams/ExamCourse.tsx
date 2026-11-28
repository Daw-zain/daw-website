"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { courseTitle, ExamError, rpc, useExamSession, type CoursePeople, type ExamFolder, type FolderKind } from "@/lib/exams/client";
import { CourseTabs } from "@/components/courses/CourseTabs";
import { ExamShell, Notice, Spinner, type ExamLabels } from "./ExamShell";

const ICONS: Record<FolderKind, string> = {
  QUESTION_BANK: "M4 6h16M4 12h16M4 18h10",
  DOMAIN_TESTS: "M4 5h7v7H4zM13 5h7v7h-7zM4 14h7v5H4zM13 14h7v5h-7z",
  EXAM_SIMULATIONS: "M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z",
  MISTAKES_QUIZ: "M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z",
  RESULTS: "M4 20V10m6 10V4m6 16v-7m4 7H2",
  CUSTOM: "M3 7h6l2 2h10v10H3z",
};

/** /[locale]/exams/course?id=… — the course's files, videos and tests (learners never see the question bank) */
export function ExamCourse(props: { locale: string; labels: ExamLabels; homeLabel: string }) {
  return (
    <Suspense fallback={<Spinner />}>
      <CourseInner {...props} />
    </Suspense>
  );
}

function CourseInner({ locale, labels, homeLabel }: { locale: string; labels: ExamLabels; homeLabel: string }) {
  const id = useSearchParams().get("id") ?? "";
  const { state, reload } = useExamSession(locale);
  const course = state.status === "ready" ? state.me.courses.find((c) => c.programId === id) : undefined;
  const title = course ? courseTitle(course, locale) : labels.title;

  return (
    <ExamShell
      locale={locale}
      labels={labels}
      state={state}
      reload={reload}
      title={title}
      crumbs={[{ href: `/${locale}`, label: homeLabel }, { href: `/${locale}/exams`, label: labels.title }, { label: course?.code ?? title }]}
    >
      {() =>
        course ? (
          <div className="space-y-6">
            <Link href={`/${locale}/exams`} className="inline-block text-sm font-semibold text-brand hover:underline">
              {locale === "ar" ? "→" : "←"} {labels.course.back}
            </Link>
            <CourseTabs
              key={course.programId}
              programId={course.programId}
              locale={locale}
              labels={labels}
              tests={<CourseFolders locale={locale} labels={labels} programId={course.programId} canSeePeople={course.access === "ADMIN" || !!course.permissions?.canViewResults} />}
            />
          </div>
        ) : (
          <Notice tone="error">
            <p>{labels.course.notFound}</p>
            <Link href={`/${locale}/exams`} className="btn btn-outline btn-sm mt-3">
              {labels.course.back}
            </Link>
          </Notice>
        )
      }
    </ExamShell>
  );
}

/** the tests section: the exam platform's folders of one course */
export function CourseFolders({ locale, labels, programId, canSeePeople }: { locale: string; labels: ExamLabels; programId: string; canSeePeople: boolean }) {
  const [folders, setFolders] = useState<ExamFolder[] | null>(null);
  const [people, setPeople] = useState<CoursePeople | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let live = true;
    setFolders(null);
    setError(false);
    rpc<ExamFolder[]>("exam_course_folders", { p_program: programId })
      .then((f) => live && setFolders(f))
      .catch(() => live && setError(true));
    if (canSeePeople)
      rpc<CoursePeople>("exam_course_people", { p_program: programId })
        .then((p) => live && setPeople(p))
        .catch((e) => live && !(e instanceof ExamError && e.code === "forbidden") && setError(true));
    return () => {
      live = false;
    };
  }, [programId, canSeePeople]);

  if (error) return <Notice tone="error">{labels.errorGeneric}</Notice>;
  if (!folders) return <Spinner />;
  const ar = locale === "ar";

  return (
    <div className="space-y-12">
      <div>
        <h2 className="text-2xl font-bold">{labels.course.folders}</h2>
        <ul className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {folders.map((f) => (
            <li key={f.id} className="card flex h-full flex-col p-6">
              <div className="flex items-center gap-3">
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-brand/10 text-brand">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5" aria-hidden="true">
                    <path d={ICONS[f.kind] ?? ICONS.CUSTOM} />
                  </svg>
                </span>
                <div className="min-w-0">
                  <h3 className="font-bold leading-snug text-navy">{ar ? f.nameAr : f.nameEn}</h3>
                  <p className="text-xs text-slate" dir={ar ? "ltr" : "rtl"}>{ar ? f.nameEn : f.nameAr}</p>
                </div>
              </div>
              {(ar ? f.descAr : f.descEn) && <p className="mt-3 text-sm leading-6 text-slate">{ar ? f.descAr : f.descEn}</p>}
              {f.kind === "QUESTION_BANK" && f.count != null ? (
                <div className="mt-auto flex items-center justify-between gap-3 pt-2">
                  <span className="text-sm text-slate">
                    <span className="text-lg font-bold text-navy">{f.count}</span> {labels.bank.total}
                  </span>
                  <Link href={`/${locale}/exams/bank?id=${encodeURIComponent(programId)}`} className="btn btn-primary btn-sm">
                    {labels.bank.open}
                  </Link>
                </div>
              ) : ["DOMAIN_TESTS", "EXAM_SIMULATIONS", "CUSTOM"].includes(f.kind) && f.count != null ? (
                <div className="mt-auto flex items-center justify-between gap-3 pt-2">
                  <span className="text-sm text-slate">
                    <span className="text-lg font-bold text-navy">{f.count}</span> {labels.builder.exams}
                    {!!f.folders && <> · <span className="text-lg font-bold text-navy">{f.folders}</span> {labels.builder.subFolders}</>}
                  </span>
                  <Link href={`/${locale}/exams/folder?id=${encodeURIComponent(f.id)}`} className="btn btn-primary btn-sm">
                    {labels.builder.folderOpen}
                  </Link>
                </div>
              ) : f.kind === "RESULTS" ? (
                <div className="mt-auto flex justify-end pt-2">
                  <Link href={`/${locale}/exams/analytics?id=${encodeURIComponent(programId)}`} className="btn btn-primary btn-sm">
                    {canSeePeople ? labels.analytics.open : labels.analytics.openMine}
                  </Link>
                </div>
              ) : f.kind === "MISTAKES_QUIZ" ? (
                <div className="mt-auto flex justify-end pt-2">
                  <Link href={`/${locale}/exams/mistakes?id=${encodeURIComponent(programId)}`} className="btn btn-primary btn-sm">
                    {labels.mistakes.open}
                  </Link>
                </div>
              ) : (
                <p className="mt-auto rounded-lg bg-mist px-3 py-2 text-sm text-slate">{labels.course.empty[f.kind] ?? labels.course.empty.CUSTOM}</p>
              )}
            </li>
          ))}
        </ul>
      </div>

      {people && (
        <div>
          <h2 className="text-2xl font-bold">{labels.course.people}</h2>
          <div className="mt-6 grid gap-5 lg:grid-cols-2">
            <PeopleList title={labels.course.instructors} empty={labels.course.noInstructors} rows={people.instructors.map((p) => ({ key: p.email, name: p.name, email: p.email }))} />
            <PeopleList
              title={labels.course.learners}
              empty={labels.course.noLearners}
              rows={people.learners.map((p) => ({ key: p.email, name: p.name, email: p.email, tag: labels.admin.enrollmentStatus[p.status] }))}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function PeopleList({ title, empty, rows }: { title: string; empty: string; rows: { key: string; name: string; email: string; tag?: string }[] }) {
  return (
    <div className="card p-6">
      <h3 className="font-bold text-navy">
        {title} <span className="text-slate">({rows.length})</span>
      </h3>
      {rows.length === 0 ? (
        <p className="mt-3 text-sm text-slate">{empty}</p>
      ) : (
        <ul className="mt-3 divide-y divide-line">
          {rows.map((r) => (
            <li key={r.key} className="flex items-center justify-between gap-3 py-2.5 text-sm">
              <span className="min-w-0">
                <span className="block truncate font-semibold text-navy">{r.name}</span>
                <span className="block truncate text-slate" dir="ltr">{r.email}</span>
              </span>
              {r.tag && <span className="shrink-0 rounded-full bg-mist px-2.5 py-1 text-xs font-semibold text-slate">{r.tag}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
