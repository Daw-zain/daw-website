import "server-only";
import { db } from "./db";
import type { AdminLang } from "./admin-i18n";
import type { InboxKey } from "./inbox";

type Col = { key: string; label: { ar: string; en: string } };

/** Columns shown in lists / exports, and loader per inbox */
export const INBOX_VIEW: Record<InboxKey, { title: { ar: string; en: string }; cols: Col[]; load: (where: object, skip?: number, take?: number) => Promise<Record<string, unknown>[]>; count: (where: object) => Promise<number> }> = {
  registrations: {
    title: { ar: "طلبات التسجيل", en: "Registrations" },
    cols: [
      { key: "createdAt", label: { ar: "التاريخ", en: "Date" } },
      { key: "fullName", label: { ar: "الاسم", en: "Name" } },
      { key: "program", label: { ar: "البرنامج", en: "Program" } },
      { key: "session", label: { ar: "الموعد", en: "Session" } },
      { key: "email", label: { ar: "البريد", en: "Email" } },
      { key: "phone", label: { ar: "الهاتف", en: "Phone" } },
      { key: "organization", label: { ar: "جهة العمل", en: "Organization" } },
      { key: "jobTitle", label: { ar: "المسمى", en: "Job title" } },
      { key: "city", label: { ar: "المدينة", en: "City" } },
      { key: "notes", label: { ar: "ملاحظات", en: "Notes" } },
      { key: "status", label: { ar: "الحالة", en: "Status" } },
    ],
    load: async (where, skip, take) =>
      (await db.registration.findMany({ where, orderBy: { createdAt: "desc" }, skip, take, include: { program: { select: { titleAr: true, titleEn: true } }, session: { select: { startDate: true } } } })).map((r) => ({
        ...r,
        program: r.program.titleEn,
        programAr: r.program.titleAr,
        session: r.session ? r.session.startDate.toISOString().slice(0, 10) : "—",
      })),
    count: (where) => db.registration.count({ where }),
  },
  consultations: {
    title: { ar: "طلبات الاستشارة", en: "Consultation requests" },
    cols: [
      { key: "createdAt", label: { ar: "التاريخ", en: "Date" } },
      { key: "name", label: { ar: "الاسم", en: "Name" } },
      { key: "service", label: { ar: "الخدمة", en: "Service" } },
      { key: "organization", label: { ar: "الجهة", en: "Organization" } },
      { key: "email", label: { ar: "البريد", en: "Email" } },
      { key: "phone", label: { ar: "الهاتف", en: "Phone" } },
      { key: "contactMethod", label: { ar: "وسيلة التواصل", en: "Contact method" } },
      { key: "preferredDate", label: { ar: "الموعد المفضل", en: "Preferred date" } },
      { key: "description", label: { ar: "الاحتياج", en: "Need" } },
      { key: "status", label: { ar: "الحالة", en: "Status" } },
    ],
    load: async (where, skip, take) =>
      (await db.consultationRequest.findMany({ where, orderBy: { createdAt: "desc" }, skip, take, include: { service: { select: { titleEn: true } } } })).map((r) => ({ ...r, service: r.service?.titleEn ?? "General" })),
    count: (where) => db.consultationRequest.count({ where }),
  },
  corporate: {
    title: { ar: "طلبات التدريب المؤسسي", en: "Corporate training requests" },
    cols: [
      { key: "createdAt", label: { ar: "التاريخ", en: "Date" } },
      { key: "organization", label: { ar: "المؤسسة", en: "Organization" } },
      { key: "sector", label: { ar: "القطاع", en: "Sector" } },
      { key: "traineesCount", label: { ar: "عدد المتدربين", en: "Participants" } },
      { key: "programs", label: { ar: "البرامج", en: "Programs" } },
      { key: "mode", label: { ar: "النمط", en: "Format" } },
      { key: "duration", label: { ar: "المدة", en: "Duration" } },
      { key: "contactName", label: { ar: "مسؤول التواصل", en: "Contact" } },
      { key: "jobTitle", label: { ar: "المسمى", en: "Job title" } },
      { key: "email", label: { ar: "البريد", en: "Email" } },
      { key: "phone", label: { ar: "الهاتف", en: "Phone" } },
      { key: "notes", label: { ar: "ملاحظات", en: "Notes" } },
      { key: "attachmentName", label: { ar: "المرفق", en: "Attachment" } },
      { key: "status", label: { ar: "الحالة", en: "Status" } },
    ],
    load: (where, skip, take) => db.corporateRequest.findMany({ where, orderBy: { createdAt: "desc" }, skip, take }) as Promise<Record<string, unknown>[]>,
    count: (where) => db.corporateRequest.count({ where }),
  },
  messages: {
    title: { ar: "رسائل التواصل", en: "Contact messages" },
    cols: [
      { key: "createdAt", label: { ar: "التاريخ", en: "Date" } },
      { key: "name", label: { ar: "الاسم", en: "Name" } },
      { key: "subject", label: { ar: "الموضوع", en: "Subject" } },
      { key: "email", label: { ar: "البريد", en: "Email" } },
      { key: "phone", label: { ar: "الهاتف", en: "Phone" } },
      { key: "message", label: { ar: "الرسالة", en: "Message" } },
      { key: "status", label: { ar: "الحالة", en: "Status" } },
    ],
    load: (where, skip, take) => db.contactMessage.findMany({ where, orderBy: { createdAt: "desc" }, skip, take }) as Promise<Record<string, unknown>[]>,
    count: (where) => db.contactMessage.count({ where }),
  },
};

export function cell(v: unknown, lang: AdminLang) {
  if (v == null || v === "") return "—";
  if (v instanceof Date) return v.toLocaleString(lang === "ar" ? "ar-LY-u-nu-latn" : "en-GB", { dateStyle: "medium", timeStyle: "short" });
  return String(v);
}
