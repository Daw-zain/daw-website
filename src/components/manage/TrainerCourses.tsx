"use client";

import { useEffect, useState } from "react";
import { courseTitle, DEFAULT_PERMISSIONS, PERMISSION_KEYS, rpc, type ExamMe, type Permissions } from "@/lib/exams/client";
import type { AdminCourse } from "@/lib/exams/manage";
import { cn } from "@/lib/utils";
import type { ExamLabels } from "@/components/exams/ExamShell";

/** assigns one person to a course as trainer and sets what they may do there */
export function TrainerCourses({
  me,
  email,
  instructing,
  courses,
  paused,
  locale,
  labels,
  busy,
  run,
}: {
  me: ExamMe;
  email: string;
  instructing: (Permissions & { programId: string })[];
  courses: AdminCourse[];
  /** the person is currently a trainee: assignments are kept but not in effect */
  paused: boolean;
  locale: string;
  labels: ExamLabels;
  busy: boolean;
  run: (fn: () => Promise<unknown>) => void;
}) {
  const a = labels.admin;
  const u = labels.manage.users;
  const isSuper = me.role === "ADMIN";
  const [course, setCourse] = useState("");
  const [perms, setPerms] = useState<Permissions>(DEFAULT_PERMISSIONS);
  const existing = instructing.find((i) => i.programId === course);
  const mine = courses.find((c) => c.programId === course)?.mine;
  // a permission can be switched on only by someone who holds it (or if it is on already)
  const mayGrant = (k: keyof Permissions) => isSuper || !!mine?.[k] || !!existing?.[k];

  useEffect(() => {
    if (!course) return;
    const found = instructing.find((i) => i.programId === course);
    const held = courses.find((c) => c.programId === course)?.mine;
    setPerms(Object.fromEntries(PERMISSION_KEYS.map((k) => [k, found ? !!found[k] : DEFAULT_PERMISSIONS[k] && (isSuper || !!held?.[k])])) as Permissions);
  }, [course, instructing, courses, isSuper]);

  return (
    <fieldset className="rounded-xl border border-line bg-white p-4">
      <legend className="px-1 text-sm font-bold text-navy">{a.assignInstructor}</legend>
      {paused && instructing.length > 0 && <p className="mb-3 text-sm text-gold-600">{u.traineeNote}</p>}
      <label className="block text-sm">
        <span className="sr-only">{a.course}</span>
        <select value={course} onChange={(e) => setCourse(e.target.value)} className="field w-full max-w-md" disabled={busy}>
          <option value="">{a.chooseCourse}</option>
          {courses.map((c) => (
            <option key={c.programId} value={c.programId}>
              {c.code ? `${c.code} — ` : ""}
              {courseTitle(c, locale)}
              {instructing.some((i) => i.programId === c.programId) ? " ✓" : ""}
            </option>
          ))}
        </select>
      </label>
      {course && (
        <>
          <p className="mt-4 text-sm font-semibold text-navy">{a.permissions}</p>
          {!isSuper && <p className="text-xs text-slate">{u.trainerHint}</p>}
          <div className="mt-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {PERMISSION_KEYS.map((k) => (
              <label key={k} className={cn("flex items-center gap-2 text-sm text-ink", !mayGrant(k) && "opacity-50")}>
                <input type="checkbox" checked={perms[k]} onChange={(e) => setPerms({ ...perms, [k]: e.target.checked })} disabled={busy || !mayGrant(k)} className="h-4 w-4 accent-[var(--color-brand)]" />
                {a.perms[k]}
              </label>
            ))}
          </div>
          <div className="mt-4 flex flex-wrap gap-3">
            <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => run(() => rpc("exam_admin_assign_instructor", { p_program: course, p_email: email, p_perms: perms }))}>
              {existing ? a.updatePermissions : a.assignInstructor}
            </button>
            {existing && (
              <button type="button" className="btn btn-outline btn-sm" disabled={busy} onClick={() => window.confirm(a.confirmRemove) && run(() => rpc("exam_admin_remove_instructor", { p_program: course, p_email: email }))}>
                {a.removeInstructor}
              </button>
            )}
          </div>
        </>
      )}
    </fieldset>
  );
}
