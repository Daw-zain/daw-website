"use client";

/**
 * Browser side of the exam system (docs/exam-system).
 * The browser never reads exam tables: it only calls the exam_* PostgreSQL functions, which check the
 * Supabase session, the member's role and course permissions on the database side (supabase/exams.sql).
 */
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/static/supabase";
import { BASE_PATH, IS_STATIC, withBase } from "@/lib/env-public";

/** ADMIN = super admin; STAFF = admin whose permissions come from an admin role (supabase/exams.sql) */
export type Role = "ADMIN" | "STAFF" | "INSTRUCTOR" | "LEARNER";
/** platform permissions of the signed-in member: { section: [action, …] } */
export type Platform = Record<string, string[]>;
export const can = (me: { platform?: Platform }, section: string, action: string) => !!me.platform?.[section]?.includes(action);
export const isPlatformAdmin = (me: { platform?: Platform }) => Object.keys(me.platform ?? {}).length > 0;
export type FolderKind = "QUESTION_BANK" | "DOMAIN_TESTS" | "EXAM_SIMULATIONS" | "MISTAKES_QUIZ" | "RESULTS" | "CUSTOM";
export type EnrollmentStatus = "ACTIVE" | "SUSPENDED" | "COMPLETED" | "CANCELLED";

export const PERMISSION_KEYS = [
  "canEditQuestions",
  "canDeleteQuestions",
  "canManageCategories",
  "canManageScenarios",
  "canImport",
  "canExport",
  "canCreateExams",
  "canPublishExams",
  "canManageDomainTests",
  "canManageSimulations",
  "canViewResults",
  "canReviewEssays",
  "canReopenAttempts",
  "canManageContent",
] as const;
export type PermissionKey = (typeof PERMISSION_KEYS)[number];
export type Permissions = Record<PermissionKey, boolean>;

/** Defaults match the CourseInstructor column defaults in prisma/schema.prisma */
export const DEFAULT_PERMISSIONS: Permissions = {
  canEditQuestions: true,
  canDeleteQuestions: false,
  canManageCategories: true,
  canManageScenarios: true,
  canImport: true,
  canExport: false,
  canCreateExams: true,
  canPublishExams: false,
  canManageDomainTests: true,
  canManageSimulations: true,
  canViewResults: true,
  canReviewEssays: true,
  canReopenAttempts: false,
  canManageContent: true,
};

export type ExamCourse = {
  programId: string;
  slug: string;
  code: string | null;
  titleAr: string;
  titleEn: string;
  access: Role;
  permissions: Permissions | null;
  /** the course is open through the admin role, without a trainer assignment */
  viaRole?: boolean;
};
export type ExamMe = { id: string; email: string; name: string; role: Role; courses: ExamCourse[]; platform: Platform; adminRole: { nameAr: string; nameEn: string } | null };
export type ExamFolder = { id: string; kind: FolderKind; system: boolean; nameAr: string; nameEn: string; descAr: string; descEn: string; status: string; count?: number | null };
export type CoursePeople = {
  instructors: { email: string; name: string }[];
  learners: { email: string; name: string; status: EnrollmentStatus; since: string }[];
};
export type ExamMemberRow = {
  id: string;
  email: string;
  name: string;
  role: Role;
  active: boolean;
  createdAt: string;
  adminRoleId: string | null;
  adminRole: { nameAr: string; nameEn: string; active: boolean } | null;
  instructing: ({ programId: string } & Permissions)[];
  enrollments: { programId: string; status: EnrollmentStatus; since: string; startsAt: string | null; expiresAt: string | null; open: boolean }[];
};

/** Error codes raised by the exam_* functions (see supabase/exams.sql) */
const KNOWN_ERRORS = [
  "not_authenticated",
  "account_disabled",
  "forbidden",
  "member_not_found",
  "last_admin",
  "cannot_disable_self",
  "course_not_found",
  "invalid_role",
  "invalid_status",
  "super_admin_only",
  "invalid_admin_role",
  "cannot_grant",
  "account_conflict",
  "not_found",
  "invalid_course",
  "invalid_content",
] as const;
export type ExamErrorCode = (typeof KNOWN_ERRORS)[number] | "network" | "unknown";

export class ExamError extends Error {
  constructor(public code: ExamErrorCode, message?: string) {
    super(message ?? code);
  }
}

export async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  let res;
  try {
    res = await supabase().rpc(fn, args);
  } catch {
    throw new ExamError("network");
  }
  if (res.error) {
    const msg = res.error.message ?? "";
    const code = (KNOWN_ERRORS as readonly string[]).find((c) => msg === c || msg.includes(c)) as ExamErrorCode | undefined;
    throw new ExamError(code ?? (res.error.code === "PGRST301" ? "not_authenticated" : "unknown"), msg);
  }
  return res.data as T;
}

export type SessionState =
  | { status: "loading" }
  | { status: "server" } // full Next.js server (local admin): the exam platform lives on the published site
  | { status: "ready"; me: ExamMe }
  | { status: "error"; code: ExamErrorCode };

/**
 * Signed-in exam member for the current page. Redirects to the sign-in page when there is no session.
 * `reload()` re-reads the member (e.g. after the admin changes their own role).
 */
export function useExamSession(locale: string) {
  const [state, setState] = useState<SessionState>({ status: "loading" });

  const load = useCallback(async () => {
    if (!IS_STATIC) {
      setState({ status: "server" });
      return;
    }
    setState({ status: "loading" });
    const { data } = await supabase().auth.getSession();
    if (!data.session) {
      const path = window.location.pathname;
      const here = (BASE_PATH && path.startsWith(BASE_PATH + "/") ? path.slice(BASE_PATH.length) : path) + window.location.search;
      window.location.replace(withBase(`/${locale}/account/login/?next=${encodeURIComponent(here)}`));
      return;
    }
    try {
      const me = await rpc<ExamMe>("exam_me");
      setState({ status: "ready", me });
    } catch (e) {
      setState({ status: "error", code: e instanceof ExamError ? e.code : "unknown" });
    }
  }, [locale]);

  useEffect(() => {
    load();
  }, [load]);

  return { state, reload: load };
}

/**
 * Timestamps from the database are UTC but come without a zone for "timestamp" columns
 * (e.g. "2026-11-26T11:34:16.842"); new Date() would read them as LOCAL time (2 h off in Libya).
 * Always parse through this.
 */
export function utcDate(v: string | null | undefined): Date | null {
  if (!v) return null;
  return new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(v) ? v : `${v}Z`);
}

export const courseTitle = (c: { titleAr: string; titleEn: string }, locale: string) => (locale === "ar" ? c.titleAr : c.titleEn);
