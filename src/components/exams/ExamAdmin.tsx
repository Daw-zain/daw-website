"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  courseTitle,
  DEFAULT_PERMISSIONS,
  ExamError,
  PERMISSION_KEYS,
  rpc,
  useExamSession,
  type EnrollmentStatus,
  type ExamCourse,
  type ExamMe,
  type ExamMemberRow,
  type Permissions,
  type Role,
} from "@/lib/exams/client";
import { cn } from "@/lib/utils";
import { ExamShell, Notice, Spinner, type ExamLabels } from "./ExamShell";
import { SecurityLog } from "./SecurityLog";

type Flash = { tone: "success" | "error"; text: string } | null;

/** /[locale]/exams/admin — roles, instructors per course and learner enrollment (admins only; enforced in the database) */
export function ExamAdmin({ locale, labels, homeLabel }: { locale: string; labels: ExamLabels; homeLabel: string }) {
  const { state, reload } = useExamSession(locale);
  const a = labels.admin;
  return (
    <ExamShell
      locale={locale}
      labels={labels}
      state={state}
      reload={reload}
      title={a.title}
      text={a.intro}
      crumbs={[{ href: `/${locale}`, label: homeLabel }, { href: `/${locale}/exams`, label: labels.title }, { label: a.title }]}
    >
      {(me) =>
        me.role === "ADMIN" ? (
          <>
            <Members locale={locale} labels={labels} me={me} reloadMe={reload} />
            <SecurityLog locale={locale} labels={labels} />
          </>
        ) : (
          <Notice tone="error">
            <p>{a.errors.forbidden}</p>
            <Link href={`/${locale}/exams`} className="btn btn-outline btn-sm mt-3">
              {a.back}
            </Link>
          </Notice>
        )
      }
    </ExamShell>
  );
}

function errorText(e: unknown, labels: ExamLabels) {
  const code = e instanceof ExamError ? e.code : "unknown";
  return (labels.admin.errors as Record<string, string>)[code] ?? labels.errorGeneric;
}

function Members({ locale, labels, me, reloadMe }: { locale: string; labels: ExamLabels; me: ExamMe; reloadMe: () => void }) {
  const a = labels.admin;
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState<ExamMemberRow[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(
    async (q: string) => {
      try {
        setRows(await rpc<ExamMemberRow[]>("exam_admin_members", { p_search: q }));
        setFailed(false);
      } catch {
        setFailed(true);
      }
    },
    [],
  );

  useEffect(() => {
    const t = setTimeout(() => load(search.trim()), 250);
    return () => clearTimeout(t);
  }, [search, load]);

  const courses = me.courses; // an admin receives every course from exam_me
  const code = (id: string) => courses.find((c) => c.programId === id)?.code ?? "?";

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="relative w-full max-w-md">
          <span className="sr-only">{a.search}</span>
          <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={a.search} className="field w-full" />
        </label>
        <Link href={`/${locale}/exams`} className="text-sm font-semibold text-brand hover:underline">
          {locale === "ar" ? "→" : "←"} {a.back}
        </Link>
      </div>
      <p className="mt-3 text-sm text-slate">{a.membersHint}</p>

      {failed && (
        <div className="mt-6">
          <Notice tone="error">{labels.errorGeneric}</Notice>
        </div>
      )}
      {!rows && !failed && <Spinner />}
      {rows && rows.length === 0 && <p className="mt-8 text-slate">{a.noMembers}</p>}

      {rows && rows.length > 0 && (
        <ul className="mt-6 space-y-4">
          {rows.map((m) => (
            <li key={m.id} className={cn("card overflow-hidden", !m.active && "opacity-70")}>
              <div className="flex flex-wrap items-center gap-x-6 gap-y-3 p-5">
                <div className="min-w-0 flex-1 basis-56">
                  <p className="truncate font-bold text-navy">
                    {m.name} {m.id === me.id && <span className="text-xs font-semibold text-brand">({locale === "ar" ? "أنت" : "you"})</span>}
                  </p>
                  <p className="truncate text-sm text-slate" dir="ltr">{m.email}</p>
                </div>
                <div className="text-sm">
                  <span className="block text-xs text-slate">{a.role}</span>
                  <span className="font-semibold text-navy">{labels.roles[m.role]}</span>
                </div>
                <div className="text-sm">
                  <span className="block text-xs text-slate">{a.instructorOf}</span>
                  <span className="font-semibold text-navy" dir="ltr">{m.instructing.map((i) => code(i.programId)).join(", ") || a.none}</span>
                </div>
                <div className="text-sm">
                  <span className="block text-xs text-slate">{a.enrolledIn}</span>
                  <span className="font-semibold text-navy" dir="ltr">
                    {m.enrollments.map((e) => `${code(e.programId)}${e.status === "ACTIVE" ? "" : ` (${a.enrollmentStatus[e.status]})`}`).join(", ") || a.none}
                  </span>
                </div>
                <span className={cn("rounded-full px-2.5 py-1 text-xs font-semibold", m.active ? "bg-emerald-50 text-emerald-700" : "bg-gold/10 text-gold-600")}>
                  {m.active ? a.active : a.disabled}
                </span>
                <button type="button" onClick={() => setOpen(open === m.id ? null : m.id)} className="btn btn-outline btn-sm" aria-expanded={open === m.id}>
                  {open === m.id ? a.close : a.manage}
                </button>
              </div>
              {open === m.id && (
                <MemberPanel
                  locale={locale}
                  labels={labels}
                  member={m}
                  courses={courses}
                  isSelf={m.id === me.id}
                  onChanged={async (selfChanged) => {
                    await load(search.trim());
                    if (selfChanged) reloadMe();
                  }}
                />
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function MemberPanel({
  locale,
  labels,
  member,
  courses,
  isSelf,
  onChanged,
}: {
  locale: string;
  labels: ExamLabels;
  member: ExamMemberRow;
  courses: ExamCourse[];
  isSelf: boolean;
  onChanged: (selfChanged: boolean) => Promise<void>;
}) {
  const a = labels.admin;
  const [flash, setFlash] = useState<Flash>(null);
  const [busy, setBusy] = useState(false);
  const [role, setRole] = useState<Role>(member.role);
  const [instrCourse, setInstrCourse] = useState("");
  const [perms, setPerms] = useState<Permissions>(DEFAULT_PERMISSIONS);
  const [enrCourse, setEnrCourse] = useState("");
  const [enrStatus, setEnrStatus] = useState<EnrollmentStatus>("ACTIVE");

  const existing = member.instructing.find((i) => i.programId === instrCourse);
  useEffect(() => {
    if (!instrCourse) return;
    const found = member.instructing.find((i) => i.programId === instrCourse);
    setPerms(found ? (Object.fromEntries(PERMISSION_KEYS.map((k) => [k, !!found[k]])) as Permissions) : DEFAULT_PERMISSIONS);
  }, [instrCourse, member.instructing]);
  useEffect(() => {
    const found = member.enrollments.find((e) => e.programId === enrCourse);
    setEnrStatus(found?.status ?? "ACTIVE");
  }, [enrCourse, member.enrollments]);

  const run = async (fn: () => Promise<unknown>, selfChanged = false) => {
    setBusy(true);
    setFlash(null);
    try {
      await fn();
      setFlash({ tone: "success", text: a.saved });
      await onChanged(selfChanged);
    } catch (e) {
      setFlash({ tone: "error", text: errorText(e, labels) });
    } finally {
      setBusy(false);
    }
  };

  const courseOptions = (
    <>
      <option value="">{a.chooseCourse}</option>
      {courses.map((c) => (
        <option key={c.programId} value={c.programId}>
          {c.code ? `${c.code} — ` : ""}
          {courseTitle(c, locale)}
        </option>
      ))}
    </>
  );

  return (
    <div className="space-y-6 border-t border-line bg-mist/50 p-5">
      {flash && <Notice tone={flash.tone}>{flash.text}</Notice>}

      {/* Role + active */}
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm">
          <span className="mb-1 block font-semibold text-navy">{a.role}</span>
          <select value={role} onChange={(e) => setRole(e.target.value as Role)} className="field w-auto" disabled={busy}>
            {(["LEARNER", "INSTRUCTOR", "ADMIN"] as Role[]).map((r) => (
              <option key={r} value={r}>
                {labels.roles[r]}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="btn btn-primary btn-sm" disabled={busy || role === member.role} onClick={() => run(() => rpc("exam_admin_set_role", { p_email: member.email, p_role: role }), isSelf)}>
          {a.saveRole}
        </button>
        {!isSelf && (
          <button
            type="button"
            className="btn btn-outline btn-sm"
            disabled={busy}
            onClick={() => run(() => rpc("exam_admin_set_active", { p_email: member.email, p_active: !member.active }))}
          >
            {member.active ? a.disable : a.enable}
          </button>
        )}
      </div>

      {/* Instructor of a course */}
      <fieldset className="rounded-xl border border-line bg-white p-4">
        <legend className="px-1 text-sm font-bold text-navy">{a.assignInstructor}</legend>
        <label className="block text-sm">
          <span className="sr-only">{a.course}</span>
          <select value={instrCourse} onChange={(e) => setInstrCourse(e.target.value)} className="field w-full max-w-md" disabled={busy}>
            {courseOptions}
          </select>
        </label>
        {instrCourse && (
          <>
            <p className="mt-4 text-sm font-semibold text-navy">{a.permissions}</p>
            <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {PERMISSION_KEYS.map((k) => (
                <label key={k} className="flex items-center gap-2 text-sm text-ink">
                  <input type="checkbox" checked={perms[k]} onChange={(e) => setPerms({ ...perms, [k]: e.target.checked })} disabled={busy} className="h-4 w-4 accent-[var(--color-brand)]" />
                  {a.perms[k]}
                </label>
              ))}
            </div>
            <div className="mt-4 flex flex-wrap gap-3">
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={busy}
                onClick={() => run(() => rpc("exam_admin_assign_instructor", { p_program: instrCourse, p_email: member.email, p_perms: perms }), isSelf)}
              >
                {existing ? a.updatePermissions : a.assignInstructor}
              </button>
              {existing && (
                <button
                  type="button"
                  className="btn btn-outline btn-sm"
                  disabled={busy}
                  onClick={() => window.confirm(a.confirmRemove) && run(() => rpc("exam_admin_remove_instructor", { p_program: instrCourse, p_email: member.email }), isSelf)}
                >
                  {a.removeInstructor}
                </button>
              )}
            </div>
          </>
        )}
      </fieldset>

      {/* Enrollment */}
      <fieldset className="rounded-xl border border-line bg-white p-4">
        <legend className="px-1 text-sm font-bold text-navy">{a.enroll}</legend>
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-sm">
            <span className="sr-only">{a.course}</span>
            <select value={enrCourse} onChange={(e) => setEnrCourse(e.target.value)} className="field w-full max-w-md" disabled={busy}>
              {courseOptions}
            </select>
          </label>
          <label className="text-sm">
            <span className="sr-only">{a.enrollmentStatus.ACTIVE}</span>
            <select value={enrStatus} onChange={(e) => setEnrStatus(e.target.value as EnrollmentStatus)} className="field w-auto" disabled={busy || !enrCourse}>
              {(["ACTIVE", "SUSPENDED", "COMPLETED"] as EnrollmentStatus[]).map((s) => (
                <option key={s} value={s}>
                  {a.enrollmentStatus[s]}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={busy || !enrCourse}
            onClick={() => run(() => rpc("exam_admin_enroll", { p_program: enrCourse, p_email: member.email, p_status: enrStatus }), isSelf)}
          >
            {a.enroll}
          </button>
        </div>
      </fieldset>
    </div>
  );
}
