"use server";

import crypto from "node:crypto";
import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { checkSpam, rateLimit } from "@/lib/spam";
import { notifyAdmin } from "@/lib/notify";
import { clientIp, createSession, destroySession, getCurrentUser, hashPassword, verifyPassword } from "@/lib/auth";
import { saveFile } from "@/lib/storage";
import { ATTACHMENT_TYPES, CONTACT_METHODS, SECTORS, SESSION_MODES, UPLOAD_MAX_BYTES, isLocale } from "@/lib/constants";
import { emailLayout, escapeHtml, sendMail } from "@/lib/mail";
import { siteUrl } from "@/lib/utils";

export type FormState = {
  ok: boolean;
  /** dictionary key under forms.errors / forms.success / newsletter / account */
  message?: string;
  errors?: Record<string, string>;
  /** echo back values so the form keeps them after a server error */
  values?: Record<string, string>;
};

const phoneRe = /^[+\d][\d\s()-]{6,20}$/;
const str = (max = 200) => z.string().trim().max(max);
const req = (max = 200) => str(max).min(1, "required");
const email = z.string().trim().toLowerCase().min(1, "required").email("email").max(200);
const phone = z.string().trim().min(1, "required").regex(phoneRe, "phone");
const optPhone = z.string().trim().max(30).refine((v) => v === "" || phoneRe.test(v), "phone");
const consent = z.literal("on", { errorMap: () => ({ message: "consent" }) });

function zodErrors(err: z.ZodError) {
  const out: Record<string, string> = {};
  for (const i of err.issues) {
    const k = String(i.path[0]);
    if (!out[k]) out[k] = i.message === "Required" || i.code === "invalid_type" ? "required" : i.message;
  }
  return out;
}

function values(form: FormData) {
  const v: Record<string, string> = {};
  form.forEach((val, key) => {
    if (typeof val === "string" && !key.startsWith("_") && key !== "website") v[key] = v[key] ? `${v[key]}, ${val}` : val;
  });
  return v;
}

async function guard(form: FormData, bucket: string): Promise<FormState | null> {
  if (checkSpam(form) === "spam") return { ok: false, message: "spam", values: values(form) };
  if (!rateLimit(`${bucket}:${await clientIp()}`)) return { ok: false, message: "rate", values: values(form) };
  return null;
}

const loc = (form: FormData) => {
  const l = String(form.get("_locale") ?? "ar");
  return isLocale(l) ? l : "ar";
};

// ───────────── Course registration ─────────────

const registrationSchema = z.object({
  programId: req(40),
  sessionId: str(40).optional(),
  fullName: req(120),
  email,
  phone,
  organization: str(150).optional(),
  jobTitle: str(120).optional(),
  city: str(80).optional(),
  notes: str(2000).optional(),
  consent,
});

export async function submitRegistration(_prev: FormState, form: FormData): Promise<FormState> {
  const g = await guard(form, "reg");
  if (g) return g;
  const parsed = registrationSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, message: "validation", errors: zodErrors(parsed.error), values: values(form) };
  const d = parsed.data;

  const program = await db.program.findFirst({ where: { id: d.programId, published: true } });
  if (!program || program.status === "CLOSED") return { ok: false, errors: { programId: "required" }, message: "validation", values: values(form) };

  let session = null;
  if (d.sessionId) {
    session = await db.courseSession.findFirst({
      where: { id: d.sessionId, programId: program.id, published: true },
      include: { _count: { select: { registrations: { where: { status: { not: "CANCELLED" } } } } } },
    });
    if (!session) return { ok: false, errors: { sessionId: "required" }, message: "validation", values: values(form) };
    const full = session.status !== "OPEN" || (session.seats != null && session._count.registrations >= session.seats);
    if (full) return { ok: false, message: "full", errors: { sessionId: "full" }, values: values(form) };
  }

  const user = await getCurrentUser();
  const r = await db.registration.create({
    data: {
      programId: program.id,
      sessionId: session?.id ?? null,
      userId: user?.id ?? null,
      fullName: d.fullName,
      email: d.email,
      phone: d.phone,
      organization: d.organization || null,
      jobTitle: d.jobTitle || null,
      city: d.city || null,
      notes: d.notes || null,
      locale: loc(form),
    },
  });

  await notifyAdmin({
    type: "registration",
    title: `New registration – ${program.titleEn}`,
    link: `/admin/inbox/registrations/${r.id}`,
    replyTo: d.email,
    fields: {
      Program: program.titleEn,
      Session: session ? session.startDate.toISOString().slice(0, 10) : "Interest (no date)",
      Name: d.fullName,
      Email: d.email,
      Phone: d.phone,
      Organization: d.organization,
      "Job title": d.jobTitle,
      City: d.city,
      Notes: d.notes,
    },
  });

  // Acknowledgement to the participant (only if SMTP configured)
  const isAr = loc(form) === "ar";
  await sendMail({
    to: d.email,
    subject: isAr ? `تم استلام طلب التسجيل – ${program.titleAr}` : `Registration received – ${program.titleEn}`,
    html: emailLayout(
      isAr ? "تم استلام طلب التسجيل" : "Your registration request was received",
      `<p>${isAr ? `مرحبًا ${escapeHtml(d.fullName)}،` : `Hello ${escapeHtml(d.fullName)},`}</p>
       <p>${isAr ? `شكرًا لتسجيلك في برنامج <strong>${escapeHtml(program.titleAr)}</strong>. سيتم التواصل معك قريبًا لتأكيد مقعدك.` : `Thank you for registering for <strong>${escapeHtml(program.titleEn)}</strong>. You will be contacted shortly to confirm your seat.`}</p>`,
      isAr,
    ),
  }).catch((e) => console.error("[registration ack]", e));

  return { ok: true, message: "registration" };
}

// ───────────── Consultation request ─────────────

const consultationSchema = z.object({
  serviceId: str(40).optional(),
  name: req(120),
  email,
  phone: optPhone.optional(),
  organization: str(150).optional(),
  description: req(3000),
  contactMethod: z.enum(CONTACT_METHODS),
  preferredDate: str(40).optional(),
  consent,
});

export async function submitConsultation(_prev: FormState, form: FormData): Promise<FormState> {
  const g = await guard(form, "consult");
  if (g) return g;
  const parsed = consultationSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, message: "validation", errors: zodErrors(parsed.error), values: values(form) };
  const d = parsed.data;
  if (d.contactMethod !== "EMAIL" && !d.phone) return { ok: false, message: "validation", errors: { phone: "required" }, values: values(form) };

  const service = d.serviceId ? await db.consultingService.findUnique({ where: { id: d.serviceId } }) : null;
  const r = await db.consultationRequest.create({
    data: {
      serviceId: service?.id ?? null,
      name: d.name,
      email: d.email,
      phone: d.phone || null,
      organization: d.organization || null,
      description: d.description,
      contactMethod: d.contactMethod,
      preferredDate: d.preferredDate || null,
      locale: loc(form),
    },
  });
  await notifyAdmin({
    type: "consultation",
    title: `New consultation request${service ? ` – ${service.titleEn}` : ""}`,
    link: `/admin/inbox/consultations/${r.id}`,
    replyTo: d.email,
    fields: {
      Service: service?.titleEn ?? "General",
      Name: d.name,
      Email: d.email,
      Phone: d.phone,
      Organization: d.organization,
      "Contact method": d.contactMethod,
      "Preferred date": d.preferredDate,
      Need: d.description,
    },
  });
  return { ok: true, message: "consultation" };
}

// ───────────── Corporate training request ─────────────

const corporateSchema = z.object({
  organization: req(150),
  sector: z.enum(SECTORS),
  traineesCount: z
    .string()
    .trim()
    .optional()
    .refine((v) => !v || (/^\d+$/.test(v) && Number(v) > 0 && Number(v) < 100000), "required"),
  programs: req(1000),
  mode: z.enum(SESSION_MODES),
  duration: str(120).optional(),
  contactName: req(120),
  jobTitle: str(120).optional(),
  email,
  phone,
  notes: str(3000).optional(),
  consent,
});

export async function submitCorporate(_prev: FormState, form: FormData): Promise<FormState> {
  const g = await guard(form, "corp");
  if (g) return g;
  // multi-select programs → comma separated
  const progs = form.getAll("programs").map(String).filter(Boolean);
  const raw = { ...Object.fromEntries(form), programs: progs.join(", ") };
  delete (raw as Record<string, unknown>).attachment;
  const parsed = corporateSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, message: "validation", errors: zodErrors(parsed.error), values: values(form) };
  const d = parsed.data;

  let attachment: { rel: string; name: string } | null = null;
  const file = form.get("attachment");
  if (file instanceof File && file.size > 0) {
    try {
      const saved = await saveFile(file, { folder: "corporate", visibility: "private", allowed: ATTACHMENT_TYPES, maxBytes: UPLOAD_MAX_BYTES });
      attachment = { rel: saved.rel, name: file.name.slice(0, 150) };
    } catch {
      return { ok: false, message: "file", errors: { attachment: "file" }, values: values(form) };
    }
  }

  const r = await db.corporateRequest.create({
    data: {
      organization: d.organization,
      sector: d.sector,
      traineesCount: d.traineesCount ? Number(d.traineesCount) : null,
      programs: d.programs,
      mode: d.mode,
      duration: d.duration || null,
      contactName: d.contactName,
      jobTitle: d.jobTitle || null,
      email: d.email,
      phone: d.phone,
      notes: d.notes || null,
      attachmentPath: attachment?.rel ?? null,
      attachmentName: attachment?.name ?? null,
      locale: loc(form),
    },
  });
  await notifyAdmin({
    type: "corporate",
    title: `Corporate training request – ${d.organization}`,
    link: `/admin/inbox/corporate/${r.id}`,
    replyTo: d.email,
    fields: {
      Organization: d.organization,
      Sector: d.sector,
      Participants: d.traineesCount,
      Programs: d.programs,
      Format: d.mode,
      Duration: d.duration,
      Contact: d.contactName,
      "Job title": d.jobTitle,
      Email: d.email,
      Phone: d.phone,
      Notes: d.notes,
      Attachment: attachment ? attachment.name : null,
    },
  });
  return { ok: true, message: "corporate" };
}

// ───────────── Contact message ─────────────

const contactSchema = z.object({
  name: req(120),
  email,
  phone: optPhone.optional(),
  subject: req(200),
  message: req(5000),
  consent,
});

export async function submitContact(_prev: FormState, form: FormData): Promise<FormState> {
  const g = await guard(form, "contact");
  if (g) return g;
  const parsed = contactSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, message: "validation", errors: zodErrors(parsed.error), values: values(form) };
  const d = parsed.data;
  const r = await db.contactMessage.create({
    data: { name: d.name, email: d.email, phone: d.phone || null, subject: d.subject, message: d.message, locale: loc(form) },
  });
  await notifyAdmin({
    type: "contact",
    title: `New message – ${d.subject}`,
    link: `/admin/inbox/messages/${r.id}`,
    replyTo: d.email,
    fields: { Name: d.name, Email: d.email, Phone: d.phone, Subject: d.subject, Message: d.message },
  });
  return { ok: true, message: "contact" };
}

// ───────────── Newsletter (double opt-in) ─────────────

export async function subscribeNewsletter(_prev: FormState, form: FormData): Promise<FormState> {
  const g = await guard(form, "news");
  if (g) return g;
  const parsed = email.safeParse(form.get("email"));
  if (!parsed.success) return { ok: false, errors: { email: "email" }, values: values(form) };
  const locale = loc(form);
  const existing = await db.subscriber.findUnique({ where: { email: parsed.data } });
  if (existing?.confirmedAt && !existing.unsubscribedAt) return { ok: true, message: "already" };

  const token = crypto.randomBytes(24).toString("hex");
  const sub = existing
    ? await db.subscriber.update({ where: { id: existing.id }, data: { token, locale, unsubscribedAt: null, confirmedAt: null } })
    : await db.subscriber.create({ data: { email: parsed.data, token, locale } });

  const isAr = locale === "ar";
  const confirmUrl = siteUrl(`/${locale}/newsletter?action=confirm&token=${sub.token}`);
  const unsubUrl = siteUrl(`/${locale}/newsletter?action=unsubscribe&token=${sub.token}`);
  await sendMail({
    to: sub.email,
    subject: isAr ? "أكّد اشتراكك في النشرة البريدية" : "Confirm your newsletter subscription",
    html: emailLayout(
      isAr ? "أكّد اشتراكك" : "Confirm your subscription",
      `<p>${isAr ? "اضغط على الزر لتأكيد اشتراكك في النشرة البريدية." : "Click the button to confirm your subscription."}</p>
       <p><a href="${confirmUrl}" style="background:#1769AA;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">${isAr ? "تأكيد الاشتراك" : "Confirm subscription"}</a></p>
       <p style="color:#52606D;font-size:13px">${isAr ? "إذا لم تطلب الاشتراك، تجاهل هذه الرسالة." : "If you did not request this, ignore this email."} <a href="${unsubUrl}" style="color:#52606D">${isAr ? "إلغاء الاشتراك" : "Unsubscribe"}</a></p>`,
      isAr,
    ),
  }).catch((e) => console.error("[newsletter]", e));

  await notifyAdmin({ type: "subscriber", title: "New newsletter sign-up (pending confirmation)", link: "/admin/subscribers", fields: { Email: sub.email, Language: locale } });
  return { ok: true, message: "pending" };
}

// ───────────── Learner accounts (LMS-ready) ─────────────

const loginSchema = z.object({ email, password: z.string().min(1, "required").max(200) });

export async function learnerLogin(_prev: FormState, form: FormData): Promise<FormState> {
  if (!rateLimit(`login:${await clientIp()}`, 10)) return { ok: false, message: "rate" };
  const parsed = loginSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, message: "invalid", values: values(form) };
  const user = await db.user.findUnique({ where: { email: parsed.data.email } });
  if (!user || !user.active || !(await verifyPassword(parsed.data.password, user.passwordHash))) {
    return { ok: false, message: "invalid", values: { email: parsed.data.email } };
  }
  await db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  await createSession(user);
  const next = String(form.get("next") ?? "");
  redirect(next.startsWith("/") && !next.startsWith("//") ? next : `/${loc(form)}/account`);
}

const registerSchema = z.object({
  name: req(120),
  email,
  password: z.string().min(8, "weak").max(200),
  confirm: z.string(),
  consent,
});

export async function learnerRegister(_prev: FormState, form: FormData): Promise<FormState> {
  const g = await guard(form, "signup");
  if (g) return g;
  const parsed = registerSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, message: "validation", errors: zodErrors(parsed.error), values: values(form) };
  const d = parsed.data;
  if (d.password !== d.confirm) return { ok: false, errors: { confirm: "mismatch" }, values: values(form) };
  if (await db.user.findUnique({ where: { email: d.email } })) return { ok: false, message: "exists", values: values(form) };
  const user = await db.user.create({
    data: { name: d.name, email: d.email, passwordHash: await hashPassword(d.password), role: "LEARNER", locale: loc(form) },
  });
  await createSession(user);
  redirect(`/${loc(form)}/account`);
}

export async function logout(form: FormData) {
  await destroySession();
  redirect(`/${loc(form)}`);
}

export async function toggleFavorite(resourceId: string, locale: string): Promise<{ saved: boolean } | { login: true }> {
  const user = await getCurrentUser();
  if (!user) return { login: true };
  const existing = await db.favorite.findUnique({ where: { userId_resourceId: { userId: user.id, resourceId } } });
  if (existing) {
    await db.favorite.delete({ where: { id: existing.id } });
  } else {
    const res = await db.resource.findFirst({ where: { id: resourceId, published: true } });
    if (!res) return { saved: false };
    await db.favorite.create({ data: { userId: user.id, resourceId } });
  }
  revalidatePath(`/${isLocale(locale) ? locale : "ar"}/account`);
  return { saved: !existing };
}
