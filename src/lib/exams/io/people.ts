/** Trainee lists from Excel / CSV files (LMS-2). Pure functions: also used by the tests. */

export type PersonRow = { email: string; name: string; phone: string; organization: string; jobTitle: string; city: string; course: string };
export const PERSON_COLUMNS: (keyof PersonRow)[] = ["name", "email", "phone", "organization", "jobTitle", "city", "course"];

const ALIASES: Record<keyof PersonRow, string[]> = {
  name: ["name", "full name", "fullname", "الاسم", "الاسم الكامل", "اسم المتدرب"],
  email: ["email", "e-mail", "mail", "البريد", "البريد الإلكتروني", "الايميل", "الإيميل"],
  phone: ["phone", "mobile", "الهاتف", "رقم الهاتف", "الجوال"],
  organization: ["organization", "organisation", "company", "الجهة", "المؤسسة", "الشركة", "جهة العمل"],
  jobTitle: ["jobtitle", "job title", "position", "المسمى الوظيفي", "الوظيفة"],
  city: ["city", "المدينة"],
  course: ["course", "course code", "الدورة", "رمز الدورة"],
};
const clean = (s: string) => s.replace(/^﻿/, "").trim().toLowerCase().replace(/\s+/g, " ");

export type PeopleParse = { rows: PersonRow[]; error: "empty" | "no_email_column" | "no_name_column" | "max_500" | null };

/** first row = headers (English or Arabic, any order) */
export function rowsToPeople(table: string[][]): PeopleParse {
  if (table.length < 2) return { rows: [], error: "empty" };
  const head = table[0].map(clean);
  const at = Object.fromEntries(PERSON_COLUMNS.map((k) => [k, head.findIndex((h) => ALIASES[k].includes(h))])) as Record<keyof PersonRow, number>;
  if (at.email < 0) return { rows: [], error: "no_email_column" };
  if (at.name < 0) return { rows: [], error: "no_name_column" };
  const rows = table
    .slice(1)
    .map((r) => Object.fromEntries(PERSON_COLUMNS.map((k) => [k, at[k] < 0 ? "" : String(r[at[k]] ?? "").trim()])) as PersonRow)
    .filter((r) => Object.values(r).some(Boolean));
  if (!rows.length) return { rows: [], error: "empty" };
  if (rows.length > 500) return { rows: [], error: "max_500" };
  return { rows, error: null };
}

/** the rows of the downloadable template */
export const peopleTemplate = (locale: string, course: string): string[][] =>
  locale === "ar"
    ? [["الاسم", "البريد الإلكتروني", "الهاتف", "الجهة", "المسمى الوظيفي", "المدينة", "رمز الدورة"], ["محمد علي", "mohamed@example.com", "0910000000", "شركة المثال", "مهندس", "طرابلس", course]]
    : [["name", "email", "phone", "organization", "job title", "city", "course"], ["Sample Name", "sample@example.com", "0910000000", "Example Co", "Engineer", "Tripoli", course]];
