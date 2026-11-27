"use client";

/** Trainees and trainers (LMS-2) — browser types and calls. Every permission is checked again on the server. */
import { supabase } from "@/lib/static/supabase";
import { withBase } from "@/lib/env-public";
import type { Permissions, Role } from "./client";
export { fromUtcDay, untilDay } from "./days";

export type PersonKind = "trainee" | "trainer";
export const ENROLL_STATUSES = ["ACTIVE", "SUSPENDED", "COMPLETED", "CANCELLED"] as const;
export type EnrollStatus = (typeof ENROLL_STATUSES)[number];

export type Subscription = { programId: string; code: string; status: EnrollStatus; startsAt: string | null; expiresAt: string | null; open: boolean };
export type Person = {
  id: string;
  name: string;
  email: string;
  active: boolean;
  createdAt: string;
  phone: string;
  organization: string;
  jobTitle: string;
  city: string;
  specialties: string;
  experienceYears: number | null;
  photoPath: string | null;
  enrollments: Subscription[];
  courses: string[];
  attempts: number;
  lastAttemptAt: string | null;
};
export type PeopleData = { total: number; page: number; pageSize: number; items: Person[] };

export type Profile = {
  phone?: string;
  organization?: string;
  jobTitle?: string;
  city?: string;
  bioAr?: string;
  bioEn?: string;
  specialties?: string;
  experienceYears?: number | null;
  photoPath?: string | null;
  adminNotes?: string;
};
export type Qualification = { id: string; kind: "QUALIFICATION" | "CERTIFICATE"; titleAr: string; titleEn: string; issuer: string; year: number | null; credential: string; filePath: string | null; fileName: string };
export type MemberRecord = {
  member: { id: string; name: string; email: string; role: Role; active: boolean; createdAt: string };
  profile: Profile;
  qualifications: Qualification[];
  enrollments: (Subscription & {
    titleAr: string;
    titleEn: string;
    since: string;
    progress: { tests: number; taken: number; passed: number; attempts: number; avgPercent: number | null; mistakes: number } | null;
  })[];
  instructing: (Permissions & { programId: string; code: string | null; titleAr: string; titleEn: string })[];
  attempts: { id: string; examId: string; titleAr: string; titleEn: string; code: string | null; attemptNo: number; status: string; startedAt: string; submittedAt: string | null; percent: number | null; passed: boolean | null; warnings: number }[];
  hiddenAttempts: number;
  activity: { at: string; action: string; details: Record<string, unknown> | null; byThem: boolean; actorName: string | null; actorEmail: string | null; course: string | null }[] | null;
  can: { edit: boolean; enroll: boolean; trainer: boolean; status: boolean; link: boolean; delete: boolean };
};

export type NewAccount = { email: string; name: string; role: "LEARNER" | "INSTRUCTOR"; phone?: string; organization?: string; jobTitle?: string; city?: string };

export class AccountError extends Error {
  constructor(public code: string) {
    super(code);
  }
}

/** calls the account server function with the signed-in member's session */
export async function accounts<T>(body: Record<string, unknown>, locale: string): Promise<T> {
  const redirectTo = window.location.origin + withBase(`/${locale}/account/reset/`);
  const { data, error } = await supabase().functions.invoke("lms-accounts", { body: { ...body, redirectTo } });
  if (error) {
    let code = "network";
    try {
      // the function answers errors with {error: code}
      code = (await (error as { context?: Response }).context?.json())?.error ?? code;
    } catch {
      /* no readable answer: a network problem */
    }
    throw new AccountError(code);
  }
  return data as T;
}

export const MEMBER_BUCKET = "member-files";
export const PHOTO_TYPES: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };
export const CERT_TYPES: Record<string, string> = { ...PHOTO_TYPES, "application/pdf": "pdf" };
export const MEMBER_FILE_MAX = 5 * 1024 * 1024;

/** uploads a profile file to the private bucket and returns its path */
export async function uploadMemberFile(memberId: string, file: File, types: Record<string, string>): Promise<string> {
  const ext = types[file.type];
  if (!ext) throw new AccountError("file_type");
  if (file.size > MEMBER_FILE_MAX) throw new AccountError("file_size");
  const path = `${memberId}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase().storage.from(MEMBER_BUCKET).upload(path, file, { contentType: file.type });
  if (error) throw new AccountError("upload");
  return path;
}

export async function removeMemberFiles(paths: (string | null | undefined)[]) {
  const list = paths.filter((p): p is string => !!p);
  if (list.length) await supabase().storage.from(MEMBER_BUCKET).remove(list).catch(() => {});
}

/** short-lived address of a private file */
export async function memberFileUrl(path: string): Promise<string | null> {
  const { data } = await supabase().storage.from(MEMBER_BUCKET).createSignedUrl(path, 600);
  return data?.signedUrl ?? null;
}
