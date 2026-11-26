"use client";

/**
 * Browser side of the exam system (docs/exam-system).
 * The browser never reads exam tables: it only calls the exam_* PostgreSQL functions, which check the
 * Supabase session, the member's role and course permissions on the database side (supabase/exams.sql).
 */
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/static/supabase";
import { BASE_PATH, IS_STATIC, withBase } from "@/lib/env-public";

export type Role = "ADMIN" | "INSTRUCTOR" | "LEARNER";
export type FolderKind = "QUESTION_BANK" | "DOMAIN_TESTS" | "EXAM_SIMULATIONS" | "MISTAKES_QUIZ" | "RESULTS" | "CUSTOM";
export type EnrollmentStatus = "ACTIVE" | "SUSPENDED" | "COMPLETED";

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
};

export type ExamCourse = {
  programId: string;
  slug: string;
  code: string | null;
  titleAr: string;
  titleEn: string;
  access: Role;
  permissions: Permissions | null;
};
export type ExamMe = { id: string; email: string; name: string; role: Role; courses: ExamCourse[] };
export type ExamFolder = { id: string; kind: FolderKind; system: boolean; nameAr: string; nameEn: string; descAr: string; descEn: string; status: string };
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
  instructing: ({ programId: string } & Permissions)[];
  enrollments: { programId: string; status: EnrollmentStatus; since: string }[];
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
  "not_found",
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

export const courseTitle = (c: { titleAr: string; titleEn: string }, locale: string) => (locale === "ar" ? c.titleAr : c.titleEn);
