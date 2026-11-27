"use client";

import { Suspense, useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { courseTitle, ExamError, rpc, type ExamMe } from "@/lib/exams/client";
import {
  accounts,
  AccountError,
  CERT_TYPES,
  ENROLL_STATUSES,
  memberFileUrl,
  PHOTO_TYPES,
  removeMemberFiles,
  uploadMemberFile,
  type EnrollStatus,
  type MemberRecord,
  type Qualification,
} from "@/lib/exams/people";
import { fromUtcDay, untilDay } from "@/lib/exams/days";
import type { AdminCourse } from "@/lib/exams/manage";
import { title } from "@/lib/exams/bank";
import { toXlsx, type Sheet } from "@/lib/exams/io/sheets";
import { cn } from "@/lib/utils";
import { Notice, Spinner, type ExamLabels } from "@/components/exams/ExamShell";
import { ManageShell } from "./ManageShell";
import { TrainerCourses } from "./TrainerCourses";
import { auditName } from "./ManageAudit";
import { day, download, LinkBox, moment, peopleError, stamp, SubBadge, subLabel, subState, XLSX_MIME, type Flash } from "./peopleShared";

/** /[locale]/manage/member?id=… — one person: profile, courses, results, certificates, activity, account */
export function ManageMember(props: { locale: string; labels: ExamLabels }) {
  return (
    <Suspense fallback={<Spinner />}>
      <Inner {...props} />
    </Suspense>
  );
}

function Inner({ locale, labels }: { locale: string; labels: ExamLabels }) {
  const id = useSearchParams().get("id") ?? "";
  return (
    <ManageShell locale={locale} labels={labels} section="trainees">
      {(me) => <Member key={id} id={id} me={me} locale={locale} labels={labels} />}
    </ManageShell>
  );
}

type Tab = "profile" | "courses" | "results" | "qualifications" | "activity";
type Run = (fn: () => Promise<unknown>, done?: string) => Promise<boolean>;

function Member({ id, me, locale, labels }: { id: string; me: ExamMe; locale: string; labels: ExamLabels }) {
  const t = labels.manage.member;
  const a = labels.admin;
  const [rec, setRec] = useState<MemberRecord | null>(null);
  const [courses, setCourses] = useState<AdminCourse[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<Flash>(null);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<Tab>("profile");
  const [link, setLink] = useState<{ link: string; email: string } | null>(null);
  const [deleted, setDeleted] = useState(false);

  const load = useCallback(async () => {
    try {
      setRec(await rpc<MemberRecord>("exam_member_record", { p_member: id }));
      setError(null);
    } catch (e) {
      setError(e instanceof ExamError && /member_not_found|not_found/.test(e.message) ? t.notFound : peopleError(e, labels));
    }
  }, [id, labels, t.notFound]);
  useEffect(() => {
    load();
    rpc<AdminCourse[]>("exam_admin_courses").then(setCourses).catch(() => {});
  }, [load]);

  const run: Run = async (fn, done) => {
    setBusy(true);
    setFlash(null);
    try {
      await fn();
      await load();
      setFlash({ tone: "success", text: done ?? a.saved });
      setBusy(false);
      return true;
    } catch (e) {
      setFlash({ tone: "error", text: peopleError(e, labels) });
      setBusy(false);
      return false;
    }
  };

  if (deleted) return <Notice tone="success"><p>{t.account.deleted}</p><Link href={`/${locale}/manage/trainees`} className="btn btn-outline btn-sm mt-3">{t.back}</Link></Notice>;
  if (error) return <Notice tone="error"><p>{error}</p><Link href={`/${locale}/manage/trainees`} className="btn btn-outline btn-sm mt-3">{t.back}</Link></Notice>;
  if (!rec) return <Spinner />;

  const m = rec.member;
  const trainer = m.role === "INSTRUCTOR";
  const list = `/${locale}/manage/${trainer ? "trainers" : m.role === "LEARNER" ? "trainees" : "users"}`;
  const tabs: Tab[] = ["profile", "courses", "results", ...(trainer || rec.qualifications.length ? (["qualifications"] as const) : []), "activity"];

  const exportRecord = () => {
    const c = labels.manage.people.cols;
    const p = rec.profile;
    const sheets: Sheet[] = [
      {
        name: t.tabs.profile,
        rows: [
          [labels.analytics.cols.metric, labels.analytics.cols.value],
          [c.name, m.name], [c.email, m.email], [a.role, labels.roles[m.role]], [c.status, m.active ? a.active : a.disabled], [c.registered, m.createdAt.slice(0, 10)],
          [c.phone, p.phone ?? ""], [c.organization, p.organization ?? ""], [c.jobTitle, p.jobTitle ?? ""], [c.city, p.city ?? ""],
        ],
      },
      {
        name: t.tabs.courses,
        rows: [
          [a.course, c.status, t.subscriptions.startsAt, c.validUntil, t.results.tests, t.results.taken, t.results.passed, c.attempts, t.results.average, t.results.mistakes, labels.content.myMemberHeader],
          ...rec.enrollments.map((e) => [e.code, subLabel(subState(e), labels), fromUtcDay(e.startsAt), untilDay(e.expiresAt), e.progress?.tests ?? "", e.progress?.taken ?? "", e.progress?.passed ?? "", e.progress?.attempts ?? "", e.progress?.avgPercent ?? "", e.progress?.mistakes ?? "", e.content?.total ? `${e.content.done}/${e.content.total}` : ""]),
        ],
      },
      {
        name: t.tabs.results,
        rows: [
          [t.results.test, a.course, t.results.attempt, c.status, t.results.started, t.results.score, t.results.passed],
          ...rec.attempts.map((x) => [title(x, locale), x.code ?? "", x.attemptNo, labels.take.statuses[x.status as keyof typeof labels.take.statuses] ?? x.status, x.startedAt.slice(0, 16).replace("T", " "), x.percent, x.passed === null ? "" : x.passed ? labels.analytics.yes : labels.analytics.no]),
        ],
      },
    ];
    download(`record-${m.email.split("@")[0]}-${stamp()}.xlsx`, toXlsx(sheets, locale === "ar") as BlobPart, XLSX_MIME);
  };

  return (
    <div className="space-y-5">
      <div className="no-print flex flex-wrap items-center justify-between gap-3">
        <Link href={list} className="text-sm font-semibold text-brand hover:underline">{locale === "ar" ? "→" : "←"} {t.back}</Link>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={exportRecord} className="btn btn-outline btn-sm">{t.exportRecord}</button>
          <button type="button" onClick={() => window.print()} className="btn btn-outline btn-sm">{t.print}</button>
        </div>
      </div>

      <div className="card flex flex-wrap items-center gap-4 p-5">
        <Photo path={rec.profile.photoPath ?? null} name={m.name} />
        <div className="min-w-0 flex-1">
          <h2 className="text-2xl font-bold">{m.name}</h2>
          <p className="text-sm text-slate" dir="ltr">{m.email}</p>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-sm">
            <span className="rounded-md bg-navy px-2 py-0.5 text-xs font-semibold text-white">{labels.roles[m.role]}</span>
            <span className={cn("rounded-md px-2 py-0.5 text-xs font-semibold", m.active ? "bg-emerald-50 text-emerald-700" : "bg-gold/10 text-gold-600")}>{m.active ? a.active : a.disabled}</span>
            <span className="text-slate">{labels.manage.people.cols.registered}: {day(m.createdAt, locale)}</span>
          </p>
        </div>
        <div className="no-print flex flex-wrap gap-2">
          {rec.can.link && (
            <button
              type="button"
              disabled={busy}
              className="btn btn-primary btn-sm"
              onClick={() =>
                run(async () => {
                  setLink(null);
                  const r = await accounts<{ link: string; email: string; renewed: boolean }>({ action: "link", memberId: m.id }, locale);
                  setLink(r);
                }, t.account.linkDone)
              }
            >
              {t.account.linkButton}
            </button>
          )}
          {rec.can.status && (
            <button
              type="button"
              disabled={busy}
              className="btn btn-outline btn-sm"
              onClick={() => (!m.active || window.confirm(labels.manage.users.confirmDisable.replace("{name}", m.name))) && run(() => rpc("exam_admin_set_active", { p_email: m.email, p_active: !m.active }))}
            >
              {m.active ? a.disable : a.enable}
            </button>
          )}
          {me.platform.users?.includes("update") && <Link href={`/${locale}/manage/users`} className="btn btn-outline btn-sm">{t.account.changeRole}</Link>}
        </div>
      </div>

      {flash && <div className="no-print"><Notice tone={flash.tone}>{flash.text}</Notice></div>}
      {link && <div className="no-print"><LinkBox link={link.link} email={link.email} labels={labels} onClose={() => setLink(null)} /></div>}

      <div className="no-print flex flex-wrap gap-2" role="tablist">
        {tabs.map((k) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={cn("btn btn-sm", tab === k ? "btn-primary" : "btn-outline")}>{t.tabs[k]}</button>
        ))}
      </div>

      {tab === "profile" && <ProfileTab rec={rec} busy={busy} run={run} labels={labels} />}
      {tab === "courses" && <CoursesTab me={me} rec={rec} courses={courses} busy={busy} run={run} locale={locale} labels={labels} />}
      {tab === "results" && <ResultsTab rec={rec} locale={locale} labels={labels} />}
      {tab === "qualifications" && <QualificationsTab rec={rec} busy={busy} run={run} labels={labels} />}
      {tab === "activity" && <ActivityTab rec={rec} locale={locale} labels={labels} />}

      {rec.can.delete && tab === "profile" && <DeleteAccount rec={rec} locale={locale} labels={labels} onDeleted={() => setDeleted(true)} />}
    </div>
  );
}

function Photo({ path, name }: { path: string | null; name: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    setUrl(null);
    if (path) memberFileUrl(path).then(setUrl).catch(() => {});
  }, [path]);
  return url ? (
    // eslint-disable-next-line @next/next/no-img-element -- a short-lived signed address of a private file
    <img src={url} alt={name} className="h-20 w-20 shrink-0 rounded-full object-cover" />
  ) : (
    <span className="grid h-20 w-20 shrink-0 place-items-center rounded-full bg-brand/10 text-2xl font-bold text-brand" aria-hidden="true">{name.trim().charAt(0) || "?"}</span>
  );
}

const PROFILE_FIELDS = ["phone", "organization", "jobTitle", "city"] as const;

function ProfileTab({ rec, busy, run, labels }: { rec: MemberRecord; busy: boolean; run: Run; labels: ExamLabels }) {
  const t = labels.manage.member.profile;
  const c = labels.manage.people.cols;
  const edit = rec.can.edit;
  const trainer = rec.member.role === "INSTRUCTOR";
  const start = () => ({
    name: rec.member.name,
    phone: rec.profile.phone ?? "",
    organization: rec.profile.organization ?? "",
    jobTitle: rec.profile.jobTitle ?? "",
    city: rec.profile.city ?? "",
    bioAr: rec.profile.bioAr ?? "",
    bioEn: rec.profile.bioEn ?? "",
    specialties: rec.profile.specialties ?? "",
    experienceYears: rec.profile.experienceYears?.toString() ?? "",
    adminNotes: rec.profile.adminNotes ?? "",
  });
  const [v, setV] = useState(start);
  useEffect(() => setV(start()), [rec]); // eslint-disable-line react-hooks/exhaustive-deps -- reset after a reload

  const submit = (e: FormEvent) => {
    e.preventDefault();
    run(() => rpc("exam_profile_save", { p_member: rec.member.id, p_data: v }));
  };
  const photo = (file: File) =>
    run(async () => {
      const path = await uploadMemberFile(rec.member.id, file, PHOTO_TYPES);
      try {
        const r = await rpc<{ previous: string | null }>("exam_member_photo", { p_member: rec.member.id, p_path: path });
        await removeMemberFiles([r.previous]);
      } catch (e) {
        await removeMemberFiles([path]);
        throw e;
      }
    });
  const area = (k: "bioAr" | "bioEn" | "specialties" | "adminNotes", label: string, hint?: string) => (
    <label className="text-sm sm:col-span-2">
      <span className="mb-1 block font-semibold text-navy">{label}</span>
      <textarea className="field w-full" rows={k === "specialties" ? 3 : 4} maxLength={3000} dir={k === "bioAr" ? "rtl" : k === "bioEn" ? "ltr" : undefined} disabled={!edit || busy} value={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.value })} />
      {hint && <span className="text-xs text-slate">{hint}</span>}
    </label>
  );
  const field = (k: "name" | (typeof PROFILE_FIELDS)[number] | "experienceYears", label: string) => (
    <label className="text-sm" key={k}>
      <span className="mb-1 block font-semibold text-navy">{label}</span>
      <input className="field w-full" dir={k === "phone" || k === "experienceYears" ? "ltr" : undefined} inputMode={k === "experienceYears" ? "numeric" : undefined} maxLength={k === "phone" ? 30 : k === "experienceYears" ? 2 : 150} disabled={!edit || busy} value={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.value })} />
    </label>
  );

  return (
    <form onSubmit={submit} className="card space-y-4 p-5">
      <div className="grid gap-3 sm:grid-cols-2">
        {field("name", c.name)}
        {PROFILE_FIELDS.map((k) => field(k, c[k]))}
        {trainer && field("experienceYears", c.experience)}
        {trainer && area("specialties", c.specialties, t.specialtiesHint)}
        {trainer && area("bioAr", t.bioAr)}
        {trainer && area("bioEn", t.bioEn)}
        {edit && area("adminNotes", t.adminNotes, t.adminNotesHint)}
      </div>
      {edit && (
        <div className="no-print flex flex-wrap items-center gap-3">
          <button type="submit" disabled={busy} className="btn btn-primary btn-sm">{t.save}</button>
          <label className="btn btn-outline btn-sm cursor-pointer">
            {rec.profile.photoPath ? t.changePhoto : t.addPhoto}
            <input type="file" accept={Object.keys(PHOTO_TYPES).join(",")} className="sr-only" disabled={busy} onChange={(e) => { const f = e.target.files?.[0]; if (f) photo(f); e.target.value = ""; }} />
          </label>
          {rec.profile.photoPath && (
            <button
              type="button"
              disabled={busy}
              className="text-sm font-semibold text-gold-600 hover:underline"
              onClick={() => run(async () => { const r = await rpc<{ previous: string | null }>("exam_member_photo", { p_member: rec.member.id, p_path: null }); await removeMemberFiles([r.previous]); })}
            >
              {t.removePhoto}
            </button>
          )}
          <span className="text-xs text-slate">{t.photoHint}</span>
        </div>
      )}
    </form>
  );
}

function CoursesTab({ me, rec, courses, busy, run, locale, labels }: { me: ExamMe; rec: MemberRecord; courses: AdminCourse[]; busy: boolean; run: Run; locale: string; labels: ExamLabels }) {
  const s = labels.manage.member.subscriptions;
  const [adding, setAdding] = useState("");
  const taken = new Set(rec.enrollments.map((e) => e.programId));
  const set = (programId: string, data: Record<string, string>) => run(() => rpc("exam_enrollment_set", { p_members: [rec.member.id], p_program: programId, p_data: data }));

  return (
    <div className="space-y-5">
      {rec.can.trainer && rec.member.role !== "LEARNER" && (
        <TrainerCourses me={me} email={rec.member.email} instructing={rec.instructing} courses={courses} paused={false} locale={locale} labels={labels} busy={busy} run={(fn) => run(fn)} />
      )}
      {rec.instructing.length > 0 && (
        <div className="card p-5">
          <h3 className="font-bold text-navy">{labels.admin.instructorOf}</h3>
          <ul className="mt-2 flex flex-wrap gap-2">
            {rec.instructing.map((i) => <li key={i.programId} className="rounded-md bg-mist px-2.5 py-1 text-sm text-navy">{courseTitle(i, locale)}</li>)}
          </ul>
        </div>
      )}
      <div>
        <h3 className="text-lg font-bold text-navy">{s.title}</h3>
        {rec.enrollments.length === 0 && <p className="mt-2 text-sm text-slate">{s.none}</p>}
        <ul className="mt-3 space-y-3">
          {rec.enrollments.map((e) => (
            <li key={e.programId} className="card p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h4 className="font-bold text-navy">{courseTitle(e, locale)}</h4>
                <SubBadge s={e} labels={labels} locale={locale} />
              </div>
              <p className="mt-2 text-sm text-slate">
                {e.progress
                  ? s.progress
                      .replace("{taken}", String(e.progress.taken)).replace("{tests}", String(e.progress.tests)).replace("{passed}", String(e.progress.passed))
                      .replace("{attempts}", String(e.progress.attempts)).replace("{avg}", e.progress.avgPercent === null ? "—" : `${e.progress.avgPercent}%`).replace("{mistakes}", String(e.progress.mistakes))
                  : s.noProgress}
              </p>
              {e.progress && e.progress.tests > 0 && (
                <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-mist" role="img" aria-label={`${e.progress.passed}/${e.progress.tests}`}>
                  <div className="h-full rounded-full bg-brand" style={{ width: `${(100 * e.progress.passed) / e.progress.tests}%` }} />
                </div>
              )}
              {e.content?.total > 0 && (
                <p className="mt-2 text-sm text-slate">
                  {labels.content.memberProgress.replace("{done}", String(e.content.done)).replace("{total}", String(e.content.total)).replace("{p}", String(e.content.percent))}
                </p>
              )}
              {rec.can.enroll && <SubscriptionForm key={`${e.status}-${e.startsAt}-${e.expiresAt}`} e={e} busy={busy} onSave={(d) => set(e.programId, d)} labels={labels} />}
              {!rec.can.enroll && (
                <p className="mt-2 text-sm text-slate">{s.startsAt}: {fromUtcDay(e.startsAt) || "—"} · {labels.manage.people.cols.validUntil}: {untilDay(e.expiresAt) || "—"}</p>
              )}
            </li>
          ))}
        </ul>
        {rec.can.enroll && (
          <div className="no-print mt-4 flex flex-wrap items-end gap-3">
            <label className="text-sm">
              <span className="mb-1 block font-semibold text-navy">{s.add}</span>
              <select value={adding} onChange={(e) => setAdding(e.target.value)} className="field w-auto max-w-full" disabled={busy}>
                <option value="">{labels.admin.chooseCourse}</option>
                {courses.filter((c) => !taken.has(c.programId)).map((c) => <option key={c.programId} value={c.programId}>{c.code ? `${c.code} — ` : ""}{courseTitle(c, locale)}</option>)}
              </select>
            </label>
            <button type="button" disabled={busy || !adding} className="btn btn-primary btn-sm" onClick={async () => { if (await set(adding, { status: "ACTIVE" })) setAdding(""); }}>{labels.admin.enroll}</button>
          </div>
        )}
      </div>
    </div>
  );
}

function SubscriptionForm({ e, busy, onSave, labels }: { e: MemberRecord["enrollments"][number]; busy: boolean; onSave: (d: Record<string, string>) => void; labels: ExamLabels }) {
  const s = labels.manage.member.subscriptions;
  const [status, setStatus] = useState<EnrollStatus>(e.status);
  const [from, setFrom] = useState(fromUtcDay(e.startsAt));
  const [until, setUntil] = useState(untilDay(e.expiresAt));
  const changed = status !== e.status || from !== fromUtcDay(e.startsAt) || until !== untilDay(e.expiresAt);
  return (
    <div className="no-print mt-3 flex flex-wrap items-end gap-3 border-t border-line pt-3">
      <label className="text-sm">
        <span className="mb-1 block font-semibold text-navy">{labels.manage.people.cols.status}</span>
        <select value={status} onChange={(x) => setStatus(x.target.value as EnrollStatus)} className="field w-auto" disabled={busy}>
          {ENROLL_STATUSES.map((k) => <option key={k} value={k}>{labels.admin.enrollmentStatus[k]}</option>)}
        </select>
      </label>
      <label className="text-sm">
        <span className="mb-1 block font-semibold text-navy">{s.startsAt}</span>
        <input type="date" value={from} onChange={(x) => setFrom(x.target.value)} className="field w-auto" disabled={busy} />
      </label>
      <label className="text-sm">
        <span className="mb-1 block font-semibold text-navy">{labels.manage.people.cols.validUntil}</span>
        <input type="date" value={until} onChange={(x) => setUntil(x.target.value)} className="field w-auto" disabled={busy} />
      </label>
      <button type="button" disabled={busy || !changed} className="btn btn-primary btn-sm" onClick={() => onSave({ status, startsAt: from, expiresAt: until })}>{s.save}</button>
    </div>
  );
}

const TH = "whitespace-nowrap px-3 py-2 text-start text-xs font-semibold text-slate";
const TD = "px-3 py-2 align-top text-sm";

function ResultsTab({ rec, locale, labels }: { rec: MemberRecord; locale: string; labels: ExamLabels }) {
  const t = labels.manage.member.results;
  const statuses = labels.take.statuses;
  return (
    <div className="space-y-3">
      {rec.hiddenAttempts > 0 && <Notice>{t.hidden.replace("{n}", String(rec.hiddenAttempts))}</Notice>}
      <div className="card overflow-x-auto">
        {rec.attempts.length === 0 ? (
          <p className="p-4 text-sm text-slate">{t.none}</p>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-line">
                {[t.test, labels.admin.course, t.attempt, labels.manage.people.cols.status, t.started, t.score].map((h) => <th key={h} scope="col" className={TH}>{h}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rec.attempts.map((x) => (
                <tr key={x.id}>
                  <td className={TD}><Link href={`/${locale}/exams/attempts?id=${encodeURIComponent(x.examId)}`} className="font-semibold text-brand hover:underline">{title(x, locale)}</Link></td>
                  <td className={TD}><bdi dir="ltr">{x.code}</bdi></td>
                  <td className={TD}>{x.attemptNo}</td>
                  <td className={TD}>{statuses[x.status as keyof typeof statuses] ?? x.status}</td>
                  <td className={cn(TD, "whitespace-nowrap")}>{moment(x.startedAt, locale)}</td>
                  <td className={cn(TD, "font-bold")} dir="ltr">
                    {x.percent === null ? "—" : `${x.percent}%`}
                    {x.passed !== null && <span aria-label={x.passed ? labels.analytics.passedWord : labels.analytics.failedWord}> {x.passed ? "✓" : "✗"}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

type QDraft = { id?: string; kind: Qualification["kind"]; titleAr: string; titleEn: string; issuer: string; year: string; credential: string };
const NEW_Q: QDraft = { kind: "QUALIFICATION", titleAr: "", titleEn: "", issuer: "", year: "", credential: "" };

function QualificationsTab({ rec, busy, run, labels }: { rec: MemberRecord; busy: boolean; run: Run; labels: ExamLabels }) {
  const t = labels.manage.member.qualifications;
  const edit = rec.can.edit;
  const [draft, setDraft] = useState<QDraft | null>(null);
  const [file, setFile] = useState<File | null>(null);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!draft) return;
    const done = await run(async () => {
      const path = file ? await uploadMemberFile(rec.member.id, file, CERT_TYPES) : null;
      try {
        const r = await rpc<{ previous: string | null }>("exam_qualification_save", { p_member: rec.member.id, p_data: { ...draft, ...(path ? { filePath: path, fileName: file!.name.slice(0, 200) } : {}) } });
        await removeMemberFiles([r.previous]);
      } catch (err) {
        await removeMemberFiles([path]);
        throw err;
      }
    });
    if (done) {
      setDraft(null);
      setFile(null);
    }
  };
  const open = async (path: string) => {
    const url = await memberFileUrl(path);
    if (url) window.open(url, "_blank", "noopener");
  };
  const text = (k: "titleAr" | "titleEn" | "issuer" | "year" | "credential", max: number): ReactNode => (
    <label className="text-sm" key={k}>
      <span className="mb-1 block font-semibold text-navy">{t[k]}</span>
      <input className="field w-full" dir={k === "titleEn" || k === "year" || k === "credential" ? "ltr" : undefined} maxLength={max} value={draft![k]} onChange={(e) => setDraft({ ...draft!, [k]: e.target.value })} />
    </label>
  );

  return (
    <div className="space-y-4">
      {edit && !draft && <button type="button" onClick={() => { setFile(null); setDraft({ ...NEW_Q }); }} className="btn btn-primary btn-sm">+ {t.add}</button>}
      {draft && (
        <form onSubmit={save} className="card space-y-3 p-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm">
              <span className="mb-1 block font-semibold text-navy">{t.type}</span>
              <select className="field w-full" value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value as Qualification["kind"] })}>
                <option value="QUALIFICATION">{t.kinds.QUALIFICATION}</option>
                <option value="CERTIFICATE">{t.kinds.CERTIFICATE}</option>
              </select>
            </label>
            {text("titleAr", 200)}
            {text("titleEn", 200)}
            {text("issuer", 200)}
            {text("year", 4)}
            {text("credential", 100)}
            <label className="text-sm sm:col-span-2">
              <span className="mb-1 block font-semibold text-navy">{t.file}</span>
              <input type="file" accept={Object.keys(CERT_TYPES).join(",")} onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="block text-sm" />
              <span className="text-xs text-slate">{t.fileHint}</span>
            </label>
          </div>
          <div className="flex gap-3">
            <button type="submit" disabled={busy} className="btn btn-primary btn-sm">{labels.manage.member.profile.save}</button>
            <button type="button" disabled={busy} onClick={() => setDraft(null)} className="btn btn-outline btn-sm">{labels.admin.close}</button>
          </div>
        </form>
      )}
      {rec.qualifications.length === 0 ? (
        <p className="text-sm text-slate">{t.none}</p>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {rec.qualifications.map((q) => (
            <li key={q.id} className="card p-4">
              <p className="font-bold text-navy">{q.titleAr || q.titleEn}</p>
              {q.titleAr && q.titleEn && <p className="text-sm text-slate" dir="ltr">{q.titleEn}</p>}
              <p className="text-sm text-slate">{[t.kinds[q.kind], q.issuer, q.year, q.credential].filter(Boolean).join(" · ")}</p>
              <div className="no-print mt-3 flex flex-wrap gap-3 text-sm font-semibold">
                {q.filePath && <button type="button" onClick={() => open(q.filePath!)} className="text-brand hover:underline">{t.viewFile}</button>}
                {edit && (
                  <>
                    <button type="button" onClick={() => { setFile(null); setDraft({ id: q.id, kind: q.kind, titleAr: q.titleAr, titleEn: q.titleEn, issuer: q.issuer, year: q.year?.toString() ?? "", credential: q.credential }); }} className="text-brand hover:underline">{t.edit}</button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => window.confirm(t.confirm) && run(async () => { const r = await rpc<{ previous: string | null }>("exam_qualification_delete", { p_id: q.id }); await removeMemberFiles([r.previous]); })}
                      className="text-gold-600 hover:underline"
                    >
                      {t.remove}
                    </button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ActivityTab({ rec, locale, labels }: { rec: MemberRecord; locale: string; labels: ExamLabels }) {
  const t = labels.manage.member.activity;
  if (!rec.activity) return <Notice>{t.hidden}</Notice>;
  if (!rec.activity.length) return <p className="text-sm text-slate">{t.none}</p>;
  return (
    <ul className="card divide-y divide-line">
      {rec.activity.map((x, i) => (
        <li key={i} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
          <span className="min-w-0">
            <span className="font-semibold text-navy">{auditName(x.action, labels)}</span>
            <span className="text-slate">
              {" · "}
              {x.byThem ? t.byThem : x.actorName || x.actorEmail || labels.manage.audit.system}
              {x.course ? ` · ${x.course}` : ""}
            </span>
          </span>
          <span className="text-xs text-slate">{moment(x.at, locale)}</span>
        </li>
      ))}
    </ul>
  );
}

function DeleteAccount({ rec, locale, labels, onDeleted }: { rec: MemberRecord; locale: string; labels: ExamLabels; onDeleted: () => void }) {
  const t = labels.manage.member.account;
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const matches = typed.trim().toLowerCase() === rec.member.email;
  const remove = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await accounts<{ paths: string[]; signInRemoved: boolean }>({ action: "delete", memberId: rec.member.id, confirm: typed }, locale);
      await removeMemberFiles(r.paths);
      onDeleted();
    } catch (err) {
      setError(err instanceof AccountError ? peopleError(err, labels) : labels.errorGeneric);
      setBusy(false);
    }
  };
  return (
    <section className="no-print rounded-xl border border-gold/40 p-4">
      {!open ? (
        <button type="button" onClick={() => setOpen(true)} className="text-sm font-semibold text-gold-600 hover:underline">{t.delete}</button>
      ) : (
        <form onSubmit={remove} className="space-y-3">
          <p className="text-sm leading-6 text-navy">{t.deleteText}</p>
          {error && <Notice tone="error">{error}</Notice>}
          <input className="field w-full max-w-md" dir="ltr" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={rec.member.email} aria-label={t.deleteType} autoComplete="off" />
          <div className="flex flex-wrap gap-3">
            <button type="submit" disabled={busy || !matches} className="btn btn-sm border border-gold bg-gold text-white disabled:opacity-50">{t.deleteConfirm}</button>
            <button type="button" disabled={busy} onClick={() => { setOpen(false); setTyped(""); }} className="btn btn-outline btn-sm">{labels.admin.close}</button>
          </div>
        </form>
      )}
    </section>
  );
}
