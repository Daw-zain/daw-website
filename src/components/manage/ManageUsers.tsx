"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { can, courseTitle, ExamError, rpc, type EnrollmentStatus, type ExamMe, type ExamMemberRow, type Role } from "@/lib/exams/client";
import { roleName, staffLabel, type AdminCourse, type RolesData } from "@/lib/exams/manage";
import { cn } from "@/lib/utils";
import { Notice, Spinner, type ExamLabels } from "@/components/exams/ExamShell";
import { ManageShell, SectionTitle } from "./ManageShell";
import { TrainerCourses } from "./TrainerCourses";

const ROLES: Role[] = ["LEARNER", "INSTRUCTOR", "STAFF", "ADMIN"];
type Flash = { tone: "success" | "error"; text: string } | null;

/** /[locale]/manage/users — accounts, base roles, trainers per course and enrolment */
export function ManageUsers({ locale, labels }: { locale: string; labels: ExamLabels }) {
  return (
    <ManageShell locale={locale} labels={labels} section="users">
      {(me, reload) => <Users me={me} reloadMe={reload} locale={locale} labels={labels} />}
    </ManageShell>
  );
}

function Users({ me, reloadMe, locale, labels }: { me: ExamMe; reloadMe: () => void; locale: string; labels: ExamLabels }) {
  const a = labels.admin;
  const u = labels.manage.users;
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Role | "">("");
  const [rows, setRows] = useState<ExamMemberRow[] | null>(null);
  const [courses, setCourses] = useState<AdminCourse[]>([]);
  const [roles, setRoles] = useState<RolesData["roles"]>([]);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async (q: string) => {
    try {
      setRows(await rpc<ExamMemberRow[]>("exam_admin_members", { p_search: q }));
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => load(search.trim()), 250);
    return () => clearTimeout(t);
  }, [search, load]);
  useEffect(() => {
    rpc<AdminCourse[]>("exam_admin_courses").then(setCourses).catch(() => setFailed(true));
    rpc<RolesData>("exam_roles").then((r) => setRoles(r.roles)).catch(() => setFailed(true));
  }, []);

  const code = (id: string) => courses.find((c) => c.programId === id)?.code ?? "?";
  const shown = rows?.filter((m) => !filter || m.role === filter);

  return (
    <div className="space-y-5">
      <SectionTitle title={u.title} text={u.intro} />
      <div className="flex flex-wrap items-center gap-3">
        <label className="w-full max-w-md">
          <span className="sr-only">{a.search}</span>
          <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={a.search} className="field w-full" />
        </label>
        <label>
          <span className="sr-only">{a.role}</span>
          <select value={filter} onChange={(e) => setFilter(e.target.value as Role | "")} className="field w-auto">
            <option value="">{u.allRoles}</option>
            {ROLES.map((r) => <option key={r} value={r}>{labels.roles[r]}</option>)}
          </select>
        </label>
        {shown && <span className="text-sm text-slate">{u.count.replace("{n}", String(shown.length))}</span>}
      </div>

      {failed && <Notice tone="error">{labels.errorGeneric}</Notice>}
      {!rows && !failed && <Spinner />}
      {shown && shown.length === 0 && <p className="text-slate">{a.noMembers}</p>}

      {shown && shown.length > 0 && (
        <ul className="space-y-3">
          {shown.map((m) => (
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
                  <span className="font-semibold text-navy">
                    {m.role === "STAFF" && m.adminRole ? staffLabel(labels.roles.STAFF, m.adminRole, locale) : labels.roles[m.role]}
                    {m.role === "STAFF" && m.adminRole && !m.adminRole.active && <span className="text-gold-600"> {u.roleOff}</span>}
                  </span>
                </div>
                <div className="text-sm">
                  <span className="block text-xs text-slate">{a.instructorOf}</span>
                  <span className={cn("font-semibold text-navy", m.role === "LEARNER" && "line-through opacity-60")} dir="ltr">{m.instructing.map((i) => code(i.programId)).join(", ") || a.none}</span>
                </div>
                <div className="text-sm">
                  <span className="block text-xs text-slate">{a.enrolledIn}</span>
                  <span className="font-semibold text-navy" dir="ltr">
                    {m.enrollments.map((e) => `${code(e.programId)}${e.open ? "" : ` (${e.status === "ACTIVE" ? a.enrollmentStatus.EXPIRED : a.enrollmentStatus[e.status]})`}`).join(", ") || a.none}
                  </span>
                </div>
                <span className={cn("rounded-full px-2.5 py-1 text-xs font-semibold", m.active ? "bg-emerald-50 text-emerald-700" : "bg-gold/10 text-gold-600")}>
                  {m.active ? a.active : a.disabled}
                </span>
                <Link href={`/${locale}/manage/member?id=${encodeURIComponent(m.id)}`} className="text-sm font-semibold text-brand hover:underline">{labels.manage.people.open}</Link>
                {(can(me, "users", "update") || can(me, "trainers", "update") || can(me, "trainees", "update")) && (
                  <button type="button" onClick={() => setOpen(open === m.id ? null : m.id)} className="btn btn-outline btn-sm" aria-expanded={open === m.id}>
                    {open === m.id ? a.close : a.manage}
                  </button>
                )}
              </div>
              {open === m.id && (
                <MemberPanel
                  me={me}
                  member={m}
                  courses={courses}
                  roles={roles}
                  locale={locale}
                  labels={labels}
                  onChanged={async () => {
                    await load(search.trim());
                    if (m.id === me.id) reloadMe();
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
  me,
  member,
  courses,
  roles,
  locale,
  labels,
  onChanged,
}: {
  me: ExamMe;
  member: ExamMemberRow;
  courses: AdminCourse[];
  roles: RolesData["roles"];
  locale: string;
  labels: ExamLabels;
  onChanged: () => Promise<void>;
}) {
  const a = labels.admin;
  const u = labels.manage.users;
  const [flash, setFlash] = useState<Flash>(null);
  const [busy, setBusy] = useState(false);
  const [role, setRole] = useState<Role>(member.role);
  const [adminRole, setAdminRole] = useState(member.adminRoleId ?? "");
  const [enrCourse, setEnrCourse] = useState("");
  const [enrStatus, setEnrStatus] = useState<EnrollmentStatus>("ACTIVE");

  const isSuper = me.role === "ADMIN";
  const isSelf = member.id === me.id;
  const targetIsAdmin = member.role === "ADMIN" || member.role === "STAFF";
  // only the super admin manages administrators, and nobody else changes their own account
  const protectedTarget = !isSuper && (targetIsAdmin || isSelf);
  const roleOptions: Role[] = isSuper ? ROLES : ["LEARNER", "INSTRUCTOR"];
  const usableRoles = roles.filter((r) => r.active);

  useEffect(() => {
    setEnrStatus(member.enrollments.find((e) => e.programId === enrCourse)?.status ?? "ACTIVE");
  }, [enrCourse, member.enrollments]);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setFlash(null);
    try {
      await fn();
      setFlash({ tone: "success", text: a.saved });
      await onChanged();
    } catch (e) {
      const code = e instanceof ExamError ? e.code : "unknown";
      setFlash({ tone: "error", text: (a.errors as Record<string, string>)[code] ?? labels.errorGeneric });
    } finally {
      setBusy(false);
    }
  };

  const name = member.name || member.email;
  const saveRole = () => {
    if (role === "ADMIN" && !window.confirm(u.confirmSuper.replace("{name}", name))) return;
    run(() => rpc("exam_admin_set_role", { p_email: member.email, p_role: role, p_admin_role: role === "STAFF" ? adminRole : null }));
  };
  const roleChanged = role !== member.role || (role === "STAFF" && adminRole !== (member.adminRoleId ?? ""));

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
      {protectedTarget && <Notice>{isSelf ? u.selfRole : u.superOnly}</Notice>}

      {can(me, "users", "update") && !protectedTarget && (
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-sm">
            <span className="mb-1 block font-semibold text-navy">{a.role}</span>
            <select value={role} onChange={(e) => setRole(e.target.value as Role)} className="field w-auto" disabled={busy}>
              {roleOptions.map((r) => <option key={r} value={r}>{labels.roles[r]}</option>)}
            </select>
          </label>
          {role === "STAFF" && (
            <label className="text-sm">
              <span className="mb-1 block font-semibold text-navy">{u.adminRole}</span>
              <select value={adminRole} onChange={(e) => setAdminRole(e.target.value)} className="field w-auto" disabled={busy}>
                <option value="">{usableRoles.length ? u.chooseRole : u.noRoles}</option>
                {usableRoles.map((r) => <option key={r.id} value={r.id}>{roleName(r, locale)}</option>)}
              </select>
            </label>
          )}
          <button type="button" className="btn btn-primary btn-sm" disabled={busy || !roleChanged || (role === "STAFF" && !adminRole)} onClick={saveRole}>
            {a.saveRole}
          </button>
          {!isSelf && (
            <button
              type="button"
              className="btn btn-outline btn-sm"
              disabled={busy}
              onClick={() => (!member.active || window.confirm(u.confirmDisable.replace("{name}", name))) && run(() => rpc("exam_admin_set_active", { p_email: member.email, p_active: !member.active }))}
            >
              {member.active ? a.disable : a.enable}
            </button>
          )}
        </div>
      )}

      {can(me, "trainers", "update") && !protectedTarget && (
        <TrainerCourses me={me} email={member.email} instructing={member.instructing} courses={courses} paused={member.role === "LEARNER"} locale={locale} labels={labels} busy={busy} run={run} />
      )}

      {can(me, "trainees", "update") && (
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
                {(["ACTIVE", "SUSPENDED", "COMPLETED", "CANCELLED"] as EnrollmentStatus[]).map((s) => <option key={s} value={s}>{a.enrollmentStatus[s]}</option>)}
              </select>
            </label>
            <button type="button" className="btn btn-primary btn-sm" disabled={busy || !enrCourse} onClick={() => run(() => rpc("exam_admin_enroll", { p_program: enrCourse, p_email: member.email, p_status: enrStatus }))}>
              {a.enroll}
            </button>
          </div>
        </fieldset>
      )}
    </div>
  );
}
