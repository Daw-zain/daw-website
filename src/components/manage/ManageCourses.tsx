"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { can, courseTitle, rpc, type ExamMe } from "@/lib/exams/client";
import type { CourseSummary } from "@/lib/exams/courses";
import { withBase } from "@/lib/env-public";
import { cn } from "@/lib/utils";
import { Notice, Spinner, type ExamLabels } from "@/components/exams/ExamShell";
import { contentError } from "@/components/courses/ContentEditor";
import { ManageShell, SectionTitle } from "./ManageShell";

/** /[locale]/manage/courses — every course, with what it holds */
export function ManageCourses({ locale, labels }: { locale: string; labels: ExamLabels }) {
  return (
    <ManageShell locale={locale} labels={labels} section="courses">
      {(me) => <Courses me={me} locale={locale} labels={labels} />}
    </ManageShell>
  );
}

export const publishedBadge = (published: boolean, labels: ExamLabels) => (
  <span className={cn("rounded-md px-2 py-0.5 text-xs font-semibold", published ? "bg-emerald-50 text-emerald-700" : "bg-gold/10 text-gold-600")}>
    {published ? labels.manage.courses.published : labels.manage.courses.hiddenCourse}
  </span>
);

function Courses({ me, locale, labels }: { me: ExamMe; locale: string; labels: ExamLabels }) {
  const t = labels.manage.courses;
  const [list, setList] = useState<CourseSummary[] | null>(null);
  const [q, setQ] = useState("");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    rpc<CourseSummary[]>("exam_course_list")
      .then(setList)
      .catch((e) => setError(contentError(e, labels)));
  }, [labels]);

  const needle = q.trim().toLowerCase();
  const shown = list?.filter((c) => !needle || `${c.code ?? ""} ${c.titleAr} ${c.titleEn}`.toLowerCase().includes(needle));

  return (
    <div className="space-y-5">
      <SectionTitle title={t.title} text={t.intro}>
        {can(me, "courses", "create") && (
          <button type="button" className="btn btn-primary btn-sm" onClick={() => setAdding(!adding)} aria-expanded={adding}>+ {t.add}</button>
        )}
      </SectionTitle>
      {adding && <NewCourse locale={locale} labels={labels} close={() => setAdding(false)} />}
      {error && <Notice tone="error">{error}</Notice>}
      <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t.search} aria-label={t.search} className="field w-full max-w-md" />
      {!shown && !error && <Spinner />}
      {shown && shown.length === 0 && <p className="text-sm text-slate">{t.none}</p>}
      <ul className="grid gap-4 xl:grid-cols-2">
        {shown?.map((c) => {
          const href = `/${locale}/manage/course?id=${encodeURIComponent(c.programId)}`;
          return (
            <li key={c.programId} className="card flex flex-col gap-3 p-5">
              <div className="flex flex-wrap items-center gap-2">
                {c.code && <span className="rounded-lg bg-navy px-2.5 py-1 text-xs font-bold tracking-wide text-white" dir="ltr">{c.code}</span>}
                {publishedBadge(c.published, labels)}
              </div>
              <h3 className="text-lg font-bold leading-snug text-navy">
                <Link href={`${href}&tab=info`} className="hover:text-brand">{courseTitle(c, locale)}</Link>
              </h3>
              <ul className="grid grid-cols-3 gap-2 text-center text-sm">
                {([["files", c.files, "files"], ["videos", c.videos, "videos"], ["tests", c.exams, "tests"]] as const).map(([key, n, tab]) => (
                  <li key={key}>
                    <Link href={`${href}&tab=${tab}`} className="block rounded-xl border border-line px-2 py-2.5 transition hover:border-brand hover:bg-brand/5">
                      <span className="block text-xl font-bold text-navy">{n}</span>
                      <span className="block text-xs text-slate">{labels.content.tabs[key]}</span>
                    </Link>
                  </li>
                ))}
              </ul>
              <p className="text-xs text-slate">
                {t.stats.replace("{q}", String(c.questions)).replace("{trainees}", String(c.trainees)).replace("{trainers}", String(c.trainers))}
              </p>
              <div className="mt-auto flex flex-wrap gap-2">
                <Link href={`${href}&tab=info`} className="btn btn-primary btn-sm">{t.manage}</Link>
                {c.published && (
                  <a href={withBase(`/${locale}/programs/${c.slug}/`)} target="_blank" rel="noopener" className="btn btn-outline btn-sm">{t.publicPage} ↗</a>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function NewCourse({ locale, labels, close }: { locale: string; labels: ExamLabels; close: () => void }) {
  const t = labels.manage.courses;
  const [v, setV] = useState({ titleAr: "", titleEn: "", code: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const r = await rpc<{ programId: string }>("exam_course_save", { p_program: null, p_data: v });
      window.location.assign(withBase(`/${locale}/manage/course/?id=${encodeURIComponent(r.programId)}&tab=info`));
    } catch (err) {
      setError(contentError(err, labels));
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit} className="card space-y-3 p-5">
      <p className="text-sm text-slate">{t.addNote}</p>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block"><span className="field-label">{t.fields.titleAr}</span><input required value={v.titleAr} onChange={(e) => setV({ ...v, titleAr: e.target.value })} dir="rtl" maxLength={200} className="field w-full" /></label>
        <label className="block"><span className="field-label">{t.fields.titleEn}</span><input required value={v.titleEn} onChange={(e) => setV({ ...v, titleEn: e.target.value })} dir="ltr" maxLength={200} className="field w-full" /></label>
        <label className="block"><span className="field-label">{t.fields.code}</span><input value={v.code} onChange={(e) => setV({ ...v, code: e.target.value })} dir="ltr" maxLength={30} className="field w-full" /></label>
      </div>
      {error && <Notice tone="error">{error}</Notice>}
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={busy} className="btn btn-primary btn-sm">{t.create}</button>
        <button type="button" onClick={close} disabled={busy} className="btn btn-outline btn-sm">{labels.content.close}</button>
      </div>
    </form>
  );
}
