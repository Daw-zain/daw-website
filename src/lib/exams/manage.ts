"use client";

/** Admin dashboard (LMS-1) — browser types. Every permission is checked again in the database. */
import type { Permissions } from "./client";

export type Catalogue = Record<string, string[]>;
export type AdminRole = {
  id: string;
  key: string;
  nameAr: string;
  nameEn: string;
  descAr: string;
  descEn: string;
  system: boolean;
  active: boolean;
  permissions: Catalogue;
  members: number;
};
export type RolesData = { catalogue: Catalogue; roles: AdminRole[] };
export type AdminCourse = { programId: string; code: string | null; titleAr: string; titleEn: string; mine: Permissions };

export type AuditItem = {
  source: "platform" | "website";
  at: string;
  action: string;
  entity: string | null;
  entityId: string | null;
  details: Record<string, unknown> | null;
  actorName: string | null;
  actorEmail: string | null;
  course: string | null;
};
export type AuditData = { total: number; page: number; pageSize: number; areas: string[]; items: AuditItem[] };

export const roleName = (r: { nameAr: string; nameEn: string }, locale: string) => (locale === "ar" ? r.nameAr || r.nameEn : r.nameEn || r.nameAr);

/** the order sections are listed in (the database stores them unordered) */
export const SECTION_ORDER = ["courses", "users", "trainers", "trainees", "question_bank", "exams", "results", "audit", "settings"];
export const orderedSections = (c: Catalogue) => Object.keys(c).sort((a, b) => SECTION_ORDER.indexOf(a) - SECTION_ORDER.indexOf(b));

/** "Admin — Results follower"; just the base label when the role carries the same name */
export const staffLabel = (base: string, role: { nameAr: string; nameEn: string }, locale: string) => (roleName(role, locale) === base ? base : `${base} — ${roleName(role, locale)}`);

/** a one-line reading of an entry's details */
export function auditDetails(d: Record<string, unknown> | null): string {
  if (!d) return "";
  return Object.entries(d)
    .filter(([, v]) => v !== null && v !== "")
    .map(([k, v]) => (k === "text" ? String(v) : `${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`))
    .join(" · ");
}
