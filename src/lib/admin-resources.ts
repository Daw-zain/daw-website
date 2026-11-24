import {
  FAQ_SCOPES,
  PROGRAM_CATEGORIES,
  PROGRAM_STATUS,
  RESOURCE_CATEGORIES,
  RESOURCE_TYPES,
  ROLES,
  SESSION_MODES,
  SESSION_STATUS,
} from "./constants";

type L = { ar: string; en: string };
export type FieldType = "text" | "textarea" | "markdown" | "number" | "select" | "checkbox" | "date" | "image" | "file" | "json" | "password" | "relation";

export type FieldDef = {
  name: string;
  label: L;
  type: FieldType;
  /** generate `${name}Ar` + `${name}En` */
  bilingual?: boolean;
  required?: boolean;
  nullable?: boolean;
  options?: readonly string[];
  relation?: { model: string; label: string; orderBy?: Record<string, "asc" | "desc"> };
  help?: L;
  rows?: number;
  ltr?: boolean;
  /** hide on create/edit for some resources */
  createOnly?: boolean;
  default?: string | number | boolean;
};

export type ResourceDef = {
  key: string;
  model: string;
  title: L;
  role: "EDITOR" | "ADMIN";
  fields: FieldDef[];
  list: { field: string; label: L; kind?: "bool" | "date" | "relation" | "chip" }[];
  orderBy: Record<string, "asc" | "desc">[];
  searchFields: string[];
  include?: Record<string, unknown>;
  slugFrom?: string;
  publicPath?: (row: Record<string, unknown>) => string | null;
};

const lab = (en: string, ar: string): L => ({ en, ar });
const linesHelp = lab("One item per line.", "عنصر واحد في كل سطر.");

export const RESOURCES: Record<string, ResourceDef> = {
  programs: {
    key: "programs",
    model: "program",
    title: lab("Training programs", "البرامج التدريبية"),
    role: "EDITOR",
    slugFrom: "titleEn",
    publicPath: (r) => `/ar/programs/${r.slug}`,
    orderBy: [{ order: "asc" }],
    searchFields: ["titleAr", "titleEn", "code", "slug"],
    list: [
      { field: "titleAr", label: lab("Title (AR)", "العنوان") },
      { field: "code", label: lab("Code", "الرمز") },
      { field: "status", label: lab("Status", "الحالة"), kind: "chip" },
      { field: "published", label: lab("Published", "منشور"), kind: "bool" },
      { field: "order", label: lab("Order", "الترتيب") },
    ],
    fields: [
      { name: "title", label: lab("Title", "العنوان"), type: "text", bilingual: true, required: true },
      { name: "slug", label: lab("URL slug", "الرابط المختصر"), type: "text", ltr: true, help: lab("Leave empty to generate from the English title.", "اتركه فارغًا لإنشائه من العنوان الإنجليزي.") },
      { name: "code", label: lab("Short code (e.g. PMP)", "رمز مختصر (مثل PMP)"), type: "text", nullable: true, ltr: true },
      { name: "category", label: lab("Category", "التصنيف"), type: "select", options: PROGRAM_CATEGORIES, required: true },
      { name: "status", label: lab("Registration status", "حالة التسجيل"), type: "select", options: PROGRAM_STATUS, required: true },
      { name: "summary", label: lab("Short summary", "وصف مختصر"), type: "textarea", bilingual: true, required: true, rows: 3 },
      { name: "description", label: lab("Detailed description", "الوصف التفصيلي"), type: "textarea", bilingual: true, required: true, rows: 6 },
      { name: "objectives", label: lab("Learning objectives", "الأهداف التعليمية"), type: "textarea", bilingual: true, help: linesHelp },
      { name: "audience", label: lab("Target audience", "الفئة المستهدفة"), type: "textarea", bilingual: true, help: linesHelp },
      { name: "prerequisites", label: lab("Prerequisites", "المتطلبات السابقة"), type: "textarea", bilingual: true, help: linesHelp },
      { name: "outline", label: lab("Program outline / modules", "المحاور التدريبية"), type: "textarea", bilingual: true, help: linesHelp, rows: 6 },
      { name: "outcomes", label: lab("Learning outcomes", "مخرجات التعلم"), type: "textarea", bilingual: true, help: linesHelp },
      { name: "delivery", label: lab("Delivery format", "طريقة تقديم التدريب"), type: "textarea", bilingual: true, rows: 2 },
      { name: "duration", label: lab("Duration (text, e.g. 5 days)", "المدة (نص، مثل 5 أيام)"), type: "text", bilingual: true },
      { name: "hours", label: lab("Training hours", "عدد الساعات"), type: "number", nullable: true },
      { name: "image", label: lab("Cover image", "صورة الغلاف"), type: "image", nullable: true },
      { name: "featured", label: lab("Featured on home page", "مميز في الصفحة الرئيسية"), type: "checkbox" },
      { name: "published", label: lab("Published", "منشور"), type: "checkbox", default: true },
      { name: "order", label: lab("Display order", "ترتيب العرض"), type: "number", default: 0 },
      { name: "metaTitle", label: lab("SEO title (optional)", "عنوان SEO (اختياري)"), type: "text", bilingual: true, nullable: true },
      { name: "metaDesc", label: lab("SEO description (optional)", "وصف SEO (اختياري)"), type: "textarea", bilingual: true, nullable: true, rows: 2 },
    ],
  },
  sessions: {
    key: "sessions",
    model: "courseSession",
    title: lab("Course sessions", "مواعيد الدورات"),
    role: "EDITOR",
    include: { program: { select: { titleAr: true, titleEn: true } }, _count: { select: { registrations: true } } },
    orderBy: [{ startDate: "desc" }],
    searchFields: [],
    list: [
      { field: "program", label: lab("Program", "البرنامج"), kind: "relation" },
      { field: "startDate", label: lab("Start", "البداية"), kind: "date" },
      { field: "mode", label: lab("Format", "النمط"), kind: "chip" },
      { field: "seats", label: lab("Seats", "المقاعد") },
      { field: "_count.registrations", label: lab("Registrations", "التسجيلات") },
      { field: "status", label: lab("Status", "الحالة"), kind: "chip" },
      { field: "published", label: lab("Published", "منشور"), kind: "bool" },
    ],
    fields: [
      { name: "programId", label: lab("Program", "البرنامج"), type: "relation", required: true, relation: { model: "program", label: "titleAr", orderBy: { order: "asc" } } },
      { name: "startDate", label: lab("Start date", "تاريخ البداية"), type: "date", required: true },
      { name: "endDate", label: lab("End date", "تاريخ النهاية"), type: "date", nullable: true },
      { name: "schedule", label: lab("Days & times", "الأيام والأوقات"), type: "text", bilingual: true },
      { name: "mode", label: lab("Delivery format", "نمط التدريب"), type: "select", options: SESSION_MODES, required: true },
      { name: "location", label: lab("Location / platform", "المكان / المنصة"), type: "text", bilingual: true },
      { name: "seats", label: lab("Available seats (empty = not announced)", "المقاعد المتاحة (فارغ = لم تُعلن)"), type: "number", nullable: true },
      { name: "status", label: lab("Registration status", "حالة التسجيل"), type: "select", options: SESSION_STATUS, required: true },
      { name: "published", label: lab("Published", "منشور"), type: "checkbox", default: true },
    ],
  },
  services: {
    key: "services",
    model: "consultingService",
    title: lab("Consulting services", "الخدمات الاستشارية"),
    role: "EDITOR",
    slugFrom: "titleEn",
    publicPath: (r) => `/ar/consulting/${r.slug}`,
    orderBy: [{ order: "asc" }],
    searchFields: ["titleAr", "titleEn"],
    list: [
      { field: "titleAr", label: lab("Title", "العنوان") },
      { field: "published", label: lab("Published", "منشور"), kind: "bool" },
      { field: "order", label: lab("Order", "الترتيب") },
    ],
    fields: [
      { name: "title", label: lab("Title", "العنوان"), type: "text", bilingual: true, required: true },
      { name: "slug", label: lab("URL slug", "الرابط المختصر"), type: "text", ltr: true },
      { name: "icon", label: lab("Icon", "الأيقونة"), type: "select", options: ["pmo", "governance", "methodology", "risk", "performance", "planning", "opm", "maturity", "agile", "ai"] },
      { name: "summary", label: lab("Short summary", "وصف مختصر"), type: "textarea", bilingual: true, required: true, rows: 3 },
      { name: "description", label: lab("Description", "الوصف"), type: "textarea", bilingual: true, required: true, rows: 6 },
      { name: "deliverables", label: lab("Deliverables", "المخرجات"), type: "textarea", bilingual: true, help: linesHelp },
      { name: "published", label: lab("Published", "منشور"), type: "checkbox", default: true },
      { name: "order", label: lab("Display order", "ترتيب العرض"), type: "number", default: 0 },
    ],
  },
  resources: {
    key: "resources",
    model: "resource",
    title: lab("Knowledge Hub", "المكتبة المعرفية"),
    role: "EDITOR",
    slugFrom: "titleEn",
    publicPath: (r) => `/ar/knowledge/${r.slug}`,
    orderBy: [{ publishedAt: "desc" }],
    searchFields: ["titleAr", "titleEn", "slug"],
    list: [
      { field: "titleAr", label: lab("Title", "العنوان") },
      { field: "type", label: lab("Type", "النوع"), kind: "chip" },
      { field: "category", label: lab("Category", "التصنيف"), kind: "chip" },
      { field: "publishedAt", label: lab("Date", "التاريخ"), kind: "date" },
      { field: "published", label: lab("Published", "منشور"), kind: "bool" },
    ],
    fields: [
      { name: "title", label: lab("Title", "العنوان"), type: "text", bilingual: true, required: true },
      { name: "slug", label: lab("URL slug", "الرابط المختصر"), type: "text", ltr: true },
      { name: "type", label: lab("Type", "النوع"), type: "select", options: RESOURCE_TYPES, required: true },
      { name: "category", label: lab("Category", "التصنيف"), type: "select", options: RESOURCE_CATEGORIES, required: true },
      { name: "excerpt", label: lab("Excerpt", "مقتطف"), type: "textarea", bilingual: true, rows: 3 },
      { name: "body", label: lab("Body (Markdown)", "المحتوى (Markdown)"), type: "markdown", bilingual: true, rows: 14 },
      { name: "coverImage", label: lab("Cover image", "صورة الغلاف"), type: "image", nullable: true },
      { name: "videoUrl", label: lab("Video URL (YouTube / Vimeo)", "رابط الفيديو (YouTube / Vimeo)"), type: "text", nullable: true, ltr: true },
      { name: "fileUrl", label: lab("Downloadable file", "ملف للتحميل"), type: "file", nullable: true },
      { name: "quizJson", label: lab("Quiz questions (JSON)", "أسئلة الاختبار (JSON)"), type: "json", nullable: true, help: lab('Format: {"ar":[{"q":"…","options":["…","…"],"answer":0,"explain":"…"}],"en":[…]} – see docs/ADMIN-GUIDE.md', 'الصيغة: {"ar":[{"q":"…","options":["…","…"],"answer":0,"explain":"…"}],"en":[…]} – راجع docs/ADMIN-GUIDE.md') },
      { name: "readMinutes", label: lab("Reading time (minutes)", "مدة القراءة (دقائق)"), type: "number", nullable: true },
      { name: "publishedAt", label: lab("Publish date", "تاريخ النشر"), type: "date", required: true },
      { name: "featured", label: lab("Featured", "مميز"), type: "checkbox" },
      { name: "published", label: lab("Published", "منشور"), type: "checkbox", default: true },
    ],
  },
  testimonials: {
    key: "testimonials",
    model: "testimonial",
    title: lab("Testimonials", "آراء المتدربين"),
    role: "EDITOR",
    orderBy: [{ order: "asc" }, { createdAt: "desc" }],
    searchFields: ["name"],
    list: [
      { field: "name", label: lab("Name", "الاسم") },
      { field: "consent", label: lab("Consent", "الموافقة"), kind: "bool" },
      { field: "published", label: lab("Published", "منشور"), kind: "bool" },
    ],
    fields: [
      { name: "name", label: lab("Participant name", "اسم المشارك"), type: "text", required: true },
      { name: "role", label: lab("Job title / organization", "المسمى / الجهة"), type: "text", bilingual: true },
      { name: "quote", label: lab("Testimonial", "نص الرأي"), type: "textarea", bilingual: true, required: true, rows: 4 },
      { name: "programRef", label: lab("Program attended", "البرنامج"), type: "text", nullable: true },
      { name: "photo", label: lab("Photo (with permission)", "صورة (بإذن صاحبها)"), type: "image", nullable: true },
      { name: "consent", label: lab("The participant approved publishing this testimonial", "وافق المشارك على نشر رأيه"), type: "checkbox", help: lab("Testimonials are only shown on the site when this is checked AND Published is checked.", "لا يظهر الرأي في الموقع إلا عند تفعيل هذا الخيار وخيار النشر معًا.") },
      { name: "published", label: lab("Published", "منشور"), type: "checkbox" },
      { name: "order", label: lab("Display order", "ترتيب العرض"), type: "number", default: 0 },
    ],
  },
  credentials: {
    key: "credentials",
    model: "credential",
    title: lab("Credentials", "الشهادات والمؤهلات"),
    role: "EDITOR",
    orderBy: [{ order: "asc" }],
    searchFields: ["titleAr", "titleEn"],
    list: [
      { field: "titleAr", label: lab("Title", "العنوان") },
      { field: "kind", label: lab("Kind", "النوع"), kind: "chip" },
      { field: "year", label: lab("Year", "السنة") },
      { field: "published", label: lab("Published", "منشور"), kind: "bool" },
    ],
    fields: [
      { name: "kind", label: lab("Kind", "النوع"), type: "select", options: ["PROFESSIONAL", "ACADEMIC"], required: true },
      { name: "code", label: lab("Short code", "الرمز"), type: "text", nullable: true, ltr: true },
      { name: "title", label: lab("Title", "العنوان"), type: "text", bilingual: true, required: true },
      { name: "issuer", label: lab("Issuer", "الجهة المانحة"), type: "text", bilingual: true },
      { name: "year", label: lab("Year", "السنة"), type: "number", nullable: true },
      { name: "credentialId", label: lab("Credential ID (optional)", "رقم الشهادة (اختياري)"), type: "text", nullable: true, ltr: true },
      { name: "verifyUrl", label: lab("Verification URL (optional)", "رابط التحقق (اختياري)"), type: "text", nullable: true, ltr: true },
      { name: "image", label: lab("Certificate image (real scan only)", "صورة الشهادة (نسخة حقيقية فقط)"), type: "image", nullable: true },
      { name: "description", label: lab("Description", "الوصف"), type: "textarea", bilingual: true, rows: 2 },
      { name: "published", label: lab("Published", "منشور"), type: "checkbox", default: true },
      { name: "order", label: lab("Display order", "ترتيب العرض"), type: "number", default: 0 },
    ],
  },
  stats: {
    key: "stats",
    model: "stat",
    title: lab("Numbers & milestones", "الأرقام والمحطات"),
    role: "EDITOR",
    orderBy: [{ order: "asc" }],
    searchFields: [],
    list: [
      { field: "value", label: lab("Value", "القيمة") },
      { field: "labelAr", label: lab("Label", "الوصف") },
      { field: "source", label: lab("Source", "المصدر") },
      { field: "published", label: lab("Published", "منشور"), kind: "bool" },
    ],
    fields: [
      { name: "value", label: lab("Number", "الرقم"), type: "number", required: true },
      { name: "prefix", label: lab("Prefix", "قبل الرقم"), type: "text", ltr: true },
      { name: "suffix", label: lab("Suffix (e.g. +)", "بعد الرقم (مثل +)"), type: "text", ltr: true },
      { name: "label", label: lab("Label", "الوصف"), type: "text", bilingual: true, required: true },
      { name: "source", label: lab("Source / evidence (internal)", "المصدر / الدليل (داخلي)"), type: "text", required: true, help: lab("Only publish verified numbers. Note where this number comes from.", "انشر الأرقام الموثقة فقط، ودوّن مصدر الرقم.") },
      { name: "animate", label: lab("Animated counter", "عدّاد متحرك"), type: "checkbox", default: true },
      { name: "published", label: lab("Published", "منشور"), type: "checkbox", default: true },
      { name: "order", label: lab("Display order", "ترتيب العرض"), type: "number", default: 0 },
    ],
  },
  faqs: {
    key: "faqs",
    model: "faq",
    title: lab("FAQs", "الأسئلة الشائعة"),
    role: "EDITOR",
    orderBy: [{ scope: "asc" }, { order: "asc" }],
    searchFields: ["questionAr", "questionEn"],
    list: [
      { field: "questionAr", label: lab("Question", "السؤال") },
      { field: "scope", label: lab("Page", "الصفحة"), kind: "chip" },
      { field: "published", label: lab("Published", "منشور"), kind: "bool" },
    ],
    fields: [
      { name: "scope", label: lab("Shown on", "يظهر في"), type: "select", options: FAQ_SCOPES, required: true },
      { name: "question", label: lab("Question", "السؤال"), type: "text", bilingual: true, required: true },
      { name: "answer", label: lab("Answer", "الإجابة"), type: "textarea", bilingual: true, required: true, rows: 4 },
      { name: "published", label: lab("Published", "منشور"), type: "checkbox", default: true },
      { name: "order", label: lab("Display order", "ترتيب العرض"), type: "number", default: 0 },
    ],
  },
  users: {
    key: "users",
    model: "user",
    title: lab("Users", "المستخدمون"),
    role: "ADMIN",
    orderBy: [{ role: "asc" }, { createdAt: "desc" }],
    searchFields: ["name", "email"],
    list: [
      { field: "name", label: lab("Name", "الاسم") },
      { field: "email", label: lab("Email", "البريد") },
      { field: "role", label: lab("Role", "الدور"), kind: "chip" },
      { field: "active", label: lab("Active", "نشط"), kind: "bool" },
      { field: "lastLoginAt", label: lab("Last login", "آخر دخول"), kind: "date" },
    ],
    fields: [
      { name: "name", label: lab("Name", "الاسم"), type: "text", required: true },
      { name: "email", label: lab("Email", "البريد الإلكتروني"), type: "text", required: true, ltr: true },
      { name: "role", label: lab("Role", "الدور"), type: "select", options: ROLES, required: true, help: lab("ADMIN: everything. EDITOR: content and requests. LEARNER: site account only.", "مسؤول: كل الصلاحيات. محرر: المحتوى والطلبات. متدرب: حساب في الموقع فقط.") },
      { name: "password", label: lab("Password (leave empty to keep)", "كلمة المرور (اتركها فارغة للإبقاء عليها)"), type: "password" },
      { name: "active", label: lab("Active", "نشط"), type: "checkbox", default: true },
    ],
  },
};

/** Expand bilingual fields into concrete DB columns */
export function columns(f: FieldDef) {
  return f.bilingual ? [`${f.name}Ar`, `${f.name}En`] : [f.name];
}
