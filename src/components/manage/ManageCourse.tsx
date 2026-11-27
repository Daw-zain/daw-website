"use client";

import { Suspense, useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { can, courseTitle, rpc, type ExamMe } from "@/lib/exams/client";
import { courseErrorKey, uploadCover, type CourseData, type CourseRecord } from "@/lib/exams/courses";
import { withBase } from "@/lib/env-public";
import { Notice, Spinner, type ExamLabels } from "@/components/exams/ExamShell";
import { CourseFolders } from "@/components/exams/ExamCourse";
import { CourseTabs } from "@/components/courses/CourseTabs";
import { contentError } from "@/components/courses/ContentEditor";
import { ManageShell } from "./ManageShell";
import { publishedBadge } from "./ManageCourses";

/** /[locale]/manage/course?id=… — one course: its data, files, videos, tests and progress */
export function ManageCourse({ locale, labels }: { locale: string; labels: ExamLabels }) {
  return (
    <ManageShell locale={locale} labels={labels} section="courses">
      {(me) => (
        <Suspense fallback={<Spinner />}>
          <Course me={me} locale={locale} labels={labels} />
        </Suspense>
      )}
    </ManageShell>
  );
}

function Course({ me, locale, labels }: { me: ExamMe; locale: string; labels: ExamLabels }) {
  const t = labels.manage.courses;
  const id = useSearchParams().get("id") ?? "";
  const [record, setRecord] = useState<CourseRecord | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      setRecord(await rpc<CourseRecord>("exam_course_record", { p_program: id }));
      setError("");
    } catch (e) {
      setError(contentError(e, labels));
    }
  }, [id, labels]);

  useEffect(() => {
    load();
  }, [load]);

  const back = (
    <Link href={`/${locale}/manage/courses`} className="inline-block text-sm font-semibold text-brand hover:underline">
      {locale === "ar" ? "→" : "←"} {t.back}
    </Link>
  );
  if (error) return <div className="space-y-4">{back}<Notice tone="error">{error}</Notice></div>;
  if (!record) return <Spinner />;
  const c = record.course;

  return (
    <div className="space-y-5">
      {back}
      <div className="flex flex-wrap items-center gap-3">
        {c.code && <span className="rounded-lg bg-navy px-2.5 py-1 text-xs font-bold tracking-wide text-white" dir="ltr">{c.code}</span>}
        <h2 className="min-w-0 text-2xl font-bold">{courseTitle(c, locale)}</h2>
        {publishedBadge(c.published, labels)}
        {c.published && <a href={withBase(`/${locale}/programs/${c.slug}/`)} target="_blank" rel="noopener" className="text-sm font-semibold text-brand hover:underline">{t.publicPage} ↗</a>}
      </div>
      <CourseTabs
        programId={c.id}
        locale={locale}
        labels={labels}
        info={<Info me={me} record={record} reload={load} locale={locale} labels={labels} />}
        tests={record.can.tests ? <CourseFolders locale={locale} labels={labels} programId={c.id} canSeePeople={false} /> : null}
      />
    </div>
  );
}

const SINGLE = ["code", "slug", "durationAr", "durationEn"] as const;
const TEXTS: [string, number, number][] = [
  ["summary", 3, 600],
  ["description", 7, 8000],
  ["objectives", 5, 5000],
  ["audience", 4, 3000],
  ["prerequisites", 3, 3000],
  ["outline", 7, 8000],
  ["outcomes", 5, 5000],
  ["delivery", 2, 500],
];
const KEYS = ["titleAr", "titleEn", ...SINGLE, "category", "status", "published", "featured", "hours", "order", "image", ...TEXTS.flatMap(([k]) => [`${k}Ar`, `${k}En`])];
const draftOf = (c: CourseData) => Object.fromEntries(KEYS.map((k) => [k, c[k] ?? ""])) as Record<string, string | boolean | number>;

function Info({ me, record, reload, locale, labels }: { me: ExamMe; record: CourseRecord; reload: () => Promise<void>; locale: string; labels: ExamLabels }) {
  const t = labels.manage.courses;
  const f = t.fields as Record<string, string>;
  const c = record.course;
  const [v, setV] = useState(() => draftOf(c));
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const canEdit = record.can.update;
  const set = (k: string, value: string | boolean) => setV((x) => ({ ...x, [k]: value }));
  // after a save, show what the database stored (for example the generated page address)
  const latest = useRef(c);
  latest.current = c;
  useEffect(() => setV(draftOf(latest.current)), [c.updatedAt]);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setFlash(null);
    try {
      await rpc("exam_course_save", { p_program: c.id, p_data: v });
      await reload();
      setFlash({ tone: "success", text: t.saved });
    } catch (err) {
      setFlash({ tone: "error", text: contentError(err, labels) });
    } finally {
      setBusy(false);
    }
  };

  const cover = async (file: File) => {
    setBusy(true);
    setFlash(null);
    try {
      set("image", await uploadCover(c.id, file));
      setFlash({ tone: "success", text: t.coverUploaded });
    } catch (err) {
      setFlash({ tone: "error", text: (labels.content.errors as Record<string, string>)[courseErrorKey(err)] ?? labels.errorGeneric });
    } finally {
      setBusy(false);
    }
  };

  const field = (k: string, dir: "rtl" | "ltr", props: Record<string, unknown> = {}) => (
    <label className="block">
      <span className="field-label">{f[k]}</span>
      <input value={String(v[k] ?? "")} onChange={(e) => set(k, e.target.value)} dir={dir} className="field w-full" {...props} />
    </label>
  );
  const image = String(v.image ?? "");

  return (
    <div className="space-y-6">
      <form onSubmit={save} className="space-y-5">
        {!canEdit && <Notice>{t.readOnly}</Notice>}
        <fieldset disabled={!canEdit || busy} className="space-y-5">
          <div className="card grid gap-4 p-5 sm:grid-cols-2">
            {field("titleAr", "rtl", { required: true, maxLength: 200 })}
            {field("titleEn", "ltr", { required: true, maxLength: 200 })}
            {field("code", "ltr", { maxLength: 30 })}
            {field("slug", "ltr", { maxLength: 80 })}
            <label className="block">
              <span className="field-label">{f.category}</span>
              <select value={String(v.category)} onChange={(e) => set("category", e.target.value)} className="field w-full">
                {Object.entries(t.categories).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="field-label">{f.status}</span>
              <select value={String(v.status)} onChange={(e) => set("status", e.target.value)} className="field w-full">
                {Object.entries(t.statuses).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
              </select>
            </label>
            {field("durationAr", "rtl", { maxLength: 100 })}
            {field("durationEn", "ltr", { maxLength: 100 })}
            {field("hours", "ltr", { type: "number", min: 0, max: 9999 })}
            {field("order", "ltr", { type: "number", min: 0, max: 99999 })}
            <label className="flex items-start gap-2 text-sm sm:col-span-2">
              <input type="checkbox" checked={!!v.published} onChange={(e) => set("published", e.target.checked)} className="mt-1 h-4 w-4 accent-[var(--color-brand)]" />
              <span><span className="font-semibold text-navy">{f.published}</span><span className="block text-xs leading-5 text-slate">{t.publishNote}</span></span>
            </label>
            <label className="flex items-center gap-2 text-sm sm:col-span-2">
              <input type="checkbox" checked={!!v.featured} onChange={(e) => set("featured", e.target.checked)} className="h-4 w-4 accent-[var(--color-brand)]" />
              {f.featured}
            </label>
          </div>

          <div className="card space-y-3 p-5">
            <p className="font-bold text-navy">{f.image}</p>
            {image ? (
              // eslint-disable-next-line @next/next/no-img-element -- preview of a public cover or a site image
              <img src={image.startsWith("/") ? withBase(image) : image} alt="" className="max-h-56 rounded-xl border border-line object-cover" />
            ) : (
              <p className="text-sm text-slate">{t.noCover}</p>
            )}
            {canEdit && (
              <div className="flex flex-wrap items-center gap-2">
                <label className="btn btn-outline btn-sm cursor-pointer">
                  {t.chooseCover}
                  <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ""; if (file) cover(file); }} />
                </label>
                {image && <button type="button" className="rounded-lg px-2.5 py-1.5 text-sm font-semibold text-gold-600 hover:bg-gold/10" onClick={() => set("image", "")}>{t.removeCover}</button>}
                <span className="text-xs text-slate">{t.coverHint}</span>
              </div>
            )}
          </div>

          <div className="card space-y-4 p-5">
            <p className="text-xs text-slate">{t.listHint}</p>
            {TEXTS.map(([key, rows, max]) => (
              <div key={key} className="grid gap-3 sm:grid-cols-2">
                {(["Ar", "En"] as const).map((lang) => (
                  <label key={lang} className="block">
                    <span className="field-label">{f[`${key}${lang}`]}</span>
                    <textarea value={String(v[`${key}${lang}`] ?? "")} onChange={(e) => set(`${key}${lang}`, e.target.value)} dir={lang === "Ar" ? "rtl" : "ltr"} rows={rows} maxLength={max} className="field w-full" />
                  </label>
                ))}
              </div>
            ))}
          </div>
        </fieldset>
        {flash && <Notice tone={flash.tone}>{flash.text}</Notice>}
        {canEdit && (
          <div className="flex justify-end">
            <button type="submit" className="btn btn-primary" disabled={busy}>{t.save}</button>
          </div>
        )}
      </form>
      <Team me={me} record={record} reload={reload} locale={locale} labels={labels} />
    </div>
  );
}

/** who teaches the course and who studies it */
function Team({ me, record, reload, locale, labels }: { me: ExamMe; record: CourseRecord; reload: () => Promise<void>; locale: string; labels: ExamLabels }) {
  const t = labels.manage.courses;
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const people = can(me, "users", "read");
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
      setEmail("");
      await reload();
    } catch (e) {
      setError((labels.admin.errors as Record<string, string>)[courseErrorKey(e)] ?? contentError(e, labels));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-5 xl:grid-cols-2">
      <section className="card p-5">
        <h3 className="font-bold text-navy">{t.trainers} <span className="text-slate">({record.trainers.length})</span></h3>
        {record.trainers.length === 0 && <p className="mt-2 text-sm text-slate">{t.noTrainers}</p>}
        <ul className="mt-2 divide-y divide-line">
          {record.trainers.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
              <span className="min-w-0">
                {people ? (
                  <Link href={`/${locale}/manage/member?id=${encodeURIComponent(p.id)}`} className="block font-semibold text-navy hover:text-brand">{p.name || p.email}</Link>
                ) : (
                  <span className="block font-semibold text-navy">{p.name || p.email}</span>
                )}
                <span className="block text-xs text-slate" dir="ltr">{p.email}</span>
              </span>
              {record.can.trainers && (
                <button type="button" disabled={busy} className="rounded-lg px-2.5 py-1.5 text-sm font-semibold text-gold-600 hover:bg-gold/10" onClick={() => window.confirm(labels.admin.confirmRemove) && run(() => rpc("exam_admin_remove_instructor", { p_program: record.course.id, p_email: p.email }))}>
                  {labels.admin.removeInstructor}
                </button>
              )}
            </li>
          ))}
        </ul>
        {record.can.trainers && (
          <div className="mt-3 border-t border-line pt-3">
            {record.candidates.length === 0 ? (
              <p className="text-sm text-slate">{t.noCandidates}</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                <select value={email} onChange={(e) => setEmail(e.target.value)} className="field w-auto max-w-full flex-1" aria-label={t.chooseTrainer} disabled={busy}>
                  <option value="">{t.chooseTrainer}</option>
                  {record.candidates.map((p) => <option key={p.email} value={p.email}>{p.name || p.email}</option>)}
                </select>
                {/* default permissions; they are adjusted in the trainer's file */}
                <button type="button" className="btn btn-primary btn-sm" disabled={busy || !email} onClick={() => run(() => rpc("exam_admin_assign_instructor", { p_program: record.course.id, p_email: email, p_perms: {} }))}>
                  {labels.admin.assignInstructor}
                </button>
              </div>
            )}
            <p className="mt-2 text-xs text-slate">{t.trainerHint}</p>
          </div>
        )}
        {error && <div className="mt-3"><Notice tone="error">{error}</Notice></div>}
      </section>

      <section className="card p-5">
        <h3 className="font-bold text-navy">{t.trainees}</h3>
        <p className="mt-2 text-sm text-slate">{t.traineeCount.replace("{n}", String(record.trainees))}</p>
        {people && <Link href={`/${locale}/manage/trainees?course=${encodeURIComponent(record.course.id)}`} className="btn btn-outline btn-sm mt-3">{t.openTrainees}</Link>}
      </section>
    </div>
  );
}
