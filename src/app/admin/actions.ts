"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { z } from "zod";
import { db } from "@/lib/db";
import { clientIp, createSession, destroySession, hashPassword, requireStaff, verifyPassword } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { rateLimit } from "@/lib/spam";
import { RESOURCES, columns, type FieldDef } from "@/lib/admin-resources";
import { saveFile, deleteFile } from "@/lib/storage";
import { IMAGE_TYPES, ATTACHMENT_TYPES } from "@/lib/constants";
import { INBOX, type InboxKey } from "@/lib/inbox";
import { SETTING_KEYS, type SettingKey } from "@/lib/settings";
import { slugify } from "@/lib/utils";
import { ADMIN_LANG_COOKIE } from "@/lib/admin-i18n";
import { emailLayout, sendMail, verifySmtp } from "@/lib/mail";

export type AdminResult = { ok: boolean; errors?: Record<string, string>; message?: string };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const model = (name: string) => (db as any)[name];

// ───────────── Auth ─────────────

export async function adminLogin(_prev: AdminResult, form: FormData): Promise<AdminResult> {
  const ip = await clientIp();
  if (!rateLimit(`admin-login:${ip}`, 8, 15 * 60 * 1000)) return { ok: false, message: "tooMany" };
  const email = String(form.get("email") ?? "").toLowerCase().trim();
  const password = String(form.get("password") ?? "");
  const user = email ? await db.user.findUnique({ where: { email } }) : null;
  const valid = user && user.active && (user.role === "ADMIN" || user.role === "EDITOR") && (await verifyPassword(password, user.passwordHash));
  if (!valid) {
    await audit(user?.id ?? null, "login_failed", "auth", null, email);
    return { ok: false, message: "invalidLogin" };
  }
  await db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  await createSession(user);
  await audit(user.id, "login", "auth");
  redirect("/admin");
}

export async function adminLogout() {
  await destroySession();
  redirect("/admin/login");
}

export async function setAdminLang(lang: string) {
  (await cookies()).set(ADMIN_LANG_COOKIE, lang === "en" ? "en" : "ar", { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
  revalidatePath("/admin", "layout");
}

// ───────────── Generic content CRUD ─────────────

async function handleUpload(form: FormData, col: string, kind: "image" | "file", userId: string): Promise<string | null | "error"> {
  const file = form.get(`${col}__file`);
  if (!(file instanceof File) || file.size === 0) return null;
  try {
    const allowed = kind === "image" ? IMAGE_TYPES : [...ATTACHMENT_TYPES, ...IMAGE_TYPES, "text/csv", "video/mp4"];
    const saved = await saveFile(file, { folder: kind === "image" ? "images" : "files", visibility: "public", allowed, maxBytes: kind === "image" ? 8 * 1024 * 1024 : 50 * 1024 * 1024 });
    await db.media.create({ data: { filename: file.name.slice(0, 200), path: saved.rel, url: saved.url!, mime: saved.mime, size: saved.size } });
    await audit(userId, "upload", "media", null, file.name);
    return saved.url!;
  } catch {
    return "error";
  }
}

async function parseField(f: FieldDef, col: string, form: FormData, isCreate: boolean, userId: string, errors: Record<string, string>) {
  const raw = form.get(col);
  const s = typeof raw === "string" ? raw.trim() : "";
  switch (f.type) {
    case "checkbox":
      return form.get(col) === "on";
    case "number": {
      if (s === "") {
        if (f.required) errors[col] = "required";
        return f.nullable ? null : Number(f.default ?? 0);
      }
      const n = Number(s);
      if (!Number.isFinite(n) || !Number.isInteger(n)) errors[col] = "number";
      return Math.trunc(n);
    }
    case "date": {
      if (!s) {
        if (f.required) errors[col] = "required";
        return null;
      }
      const d = new Date(s.length === 10 ? `${s}T09:00:00` : s);
      if (isNaN(d.getTime())) errors[col] = "date";
      return d;
    }
    case "select":
      if (!s && f.required) errors[col] = "required";
      if (s && f.options && !f.options.includes(s)) errors[col] = "invalid";
      return s || (f.nullable ? null : "");
    case "json":
      if (s) {
        try {
          JSON.parse(s);
        } catch {
          errors[col] = "json";
        }
      }
      return s || null;
    case "image":
    case "file": {
      const up = await handleUpload(form, col, f.type, userId);
      if (up === "error") {
        errors[col] = "file";
        return s || null;
      }
      return up ?? (s || null);
    }
    case "password":
      if (!s) {
        if (isCreate) errors[col] = "required";
        return undefined;
      }
      if (s.length < 10) errors[col] = "password";
      return s;
    default:
      if (!s && f.required) errors[col] = "required";
      if (s.length > 50000) errors[col] = "tooLong";
      return s === "" && f.nullable ? null : s;
  }
}

export async function saveResource(key: string, id: string | null, form: FormData): Promise<AdminResult> {
  const def = RESOURCES[key];
  if (!def) return { ok: false, message: "notFound" };
  const user = await requireStaff(def.role);
  const isCreate = !id;
  const errors: Record<string, string> = {};
  const data: Record<string, unknown> = {};

  for (const f of def.fields) {
    for (const col of columns(f)) {
      const v = await parseField(f, col, form, isCreate, user.id, errors);
      if (v !== undefined) data[col] = v;
    }
  }

  // slug
  if ("slug" in data || def.slugFrom) {
    let slug = slugify(String(data.slug || data[def.slugFrom ?? ""] || ""));
    if (!slug) slug = `item-${Date.now().toString(36)}`;
    const base = slug;
    for (let i = 2; ; i++) {
      const clash = await model(def.model).findFirst({ where: { slug, ...(id ? { NOT: { id } } : {}) }, select: { id: true } });
      if (!clash) break;
      slug = `${base}-${i}`;
    }
    data.slug = slug;
  }

  // users: email, password, self-protection
  if (key === "users") {
    const email = String(data.email ?? "").toLowerCase();
    if (!z.string().email().safeParse(email).success) errors.email = "email";
    data.email = email;
    const clash = await db.user.findFirst({ where: { email, ...(id ? { NOT: { id } } : {}) } });
    if (clash) errors.email = "exists";
    if (id === user.id && (data.role !== "ADMIN" || data.active === false)) errors.role = "self";
    if (typeof data.password === "string") data.passwordHash = await hashPassword(data.password);
    delete data.password;
  }

  if (key === "sessions" && data.endDate && data.startDate && (data.endDate as Date) < (data.startDate as Date)) errors.endDate = "date";

  if (Object.keys(errors).length) return { ok: false, errors };

  const row = isCreate ? await model(def.model).create({ data }) : await model(def.model).update({ where: { id }, data });
  await audit(user.id, isCreate ? "create" : "update", def.model, row.id, key === "users" ? String(data.email) : String(data.titleEn ?? data.name ?? data.questionEn ?? data.labelEn ?? ""));
  revalidatePath("/", "layout");
  redirect(`/admin/content/${key}?saved=1`);
}

export async function deleteResource(key: string, id: string) {
  const def = RESOURCES[key];
  if (!def) return;
  const user = await requireStaff(def.role);
  if (key === "users" && id === user.id) redirect(`/admin/content/users/${id}?error=self`);
  await model(def.model).delete({ where: { id } });
  await audit(user.id, "delete", def.model, id);
  revalidatePath("/", "layout");
  redirect(`/admin/content/${key}?deleted=1`);
}

// ───────────── Request inboxes ─────────────


export async function updateRequest(type: string, id: string, form: FormData) {
  const user = await requireStaff();
  const cfg = INBOX[type as InboxKey];
  if (!cfg) return;
  const status = String(form.get("status") ?? "");
  const adminNotes = String(form.get("adminNotes") ?? "").slice(0, 5000);
  if (!(cfg.statuses as readonly string[]).includes(status)) return;
  await model(cfg.model).update({ where: { id }, data: { status, adminNotes } });
  await audit(user.id, "status", cfg.model, id, status);
  redirect(`/admin/inbox/${type}/${id}?saved=1`);
}

export async function deleteRequest(type: string, id: string) {
  const user = await requireStaff("ADMIN");
  const cfg = INBOX[type as InboxKey];
  if (!cfg) return;
  if (type === "corporate") {
    const r = await db.corporateRequest.findUnique({ where: { id } });
    if (r?.attachmentPath) await deleteFile(r.attachmentPath, "private");
  }
  await model(cfg.model).delete({ where: { id } });
  await audit(user.id, "delete", cfg.model, id);
  redirect(`/admin/inbox/${type}?deleted=1`);
}

// ───────────── Settings ─────────────

const SETTING_UPLOADS: Partial<Record<SettingKey, "image" | "file">> = { heroImage: "image", aboutImage: "image", atpBadge: "image", partnerLogo: "image", cvUrl: "file" };

export async function saveSettings(form: FormData): Promise<AdminResult> {
  const user = await requireStaff("ADMIN");
  const errors: Record<string, string> = {};
  for (const key of Object.keys(SETTING_KEYS) as SettingKey[]) {
    let value = String(form.get(key) ?? "").trim();
    const kind = SETTING_UPLOADS[key];
    if (kind) {
      const up = await handleUpload(form, key, kind, user.id);
      if (up === "error") errors[key] = "file";
      else if (up) value = up;
    }
    if (["contactEmail", "adminNotifyEmail"].includes(key) && value && !z.string().email().safeParse(value).success) errors[key] = "email";
    if (["linkedin", "facebook", "youtube", "mapUrl"].includes(key) && value && !/^https:\/\//.test(value)) errors[key] = "url";
    await db.setting.upsert({ where: { key }, update: { value }, create: { key, value } });
  }
  if (Object.keys(errors).length) return { ok: false, errors };
  await audit(user.id, "update", "settings");
  revalidatePath("/", "layout");
  redirect("/admin/settings?saved=1");
}

// ───────────── Media ─────────────

export async function uploadMedia(form: FormData): Promise<AdminResult> {
  const user = await requireStaff();
  const files = form.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  let failed = 0;
  for (const file of files) {
    try {
      const isImg = IMAGE_TYPES.includes(file.type);
      const saved = await saveFile(file, {
        folder: isImg ? "images" : "files",
        visibility: "public",
        allowed: [...IMAGE_TYPES, ...ATTACHMENT_TYPES, "text/csv", "video/mp4"],
        maxBytes: isImg ? 8 * 1024 * 1024 : 50 * 1024 * 1024,
      });
      await db.media.create({ data: { filename: file.name.slice(0, 200), path: saved.rel, url: saved.url!, mime: saved.mime, size: saved.size, altAr: String(form.get("altAr") ?? ""), altEn: String(form.get("altEn") ?? "") } });
      await audit(user.id, "upload", "media", null, file.name);
    } catch {
      failed++;
    }
  }
  if (failed) return { ok: false, message: `${failed} file(s) rejected (type or size).` };
  redirect("/admin/media?saved=1");
}

export async function deleteMedia(id: string) {
  const user = await requireStaff();
  const m = await db.media.findUnique({ where: { id } });
  if (!m) return;
  await deleteFile(m.path, "public");
  await db.media.delete({ where: { id } });
  await audit(user.id, "delete", "media", id, m.filename);
  redirect("/admin/media?deleted=1");
}

// ───────────── Subscribers & notifications ─────────────

export async function deleteSubscriber(id: string) {
  const user = await requireStaff("ADMIN");
  await db.subscriber.delete({ where: { id } });
  await audit(user.id, "delete", "subscriber", id);
  redirect("/admin/subscribers?deleted=1");
}

export async function markNotificationsRead() {
  await requireStaff();
  await db.notification.updateMany({ where: { read: false }, data: { read: true } });
  revalidatePath("/admin");
}

// ───────────── Email (SMTP) test ─────────────

export async function sendTestEmail(_prev: AdminResult, form: FormData): Promise<AdminResult> {
  const user = await requireStaff("ADMIN");
  const to = String(form.get("to") ?? "").trim().toLowerCase();
  if (!z.string().email().safeParse(to).success) return { ok: false, message: "Enter a valid email address." };
  const check = await verifySmtp();
  if (!check.ok) {
    await audit(user.id, "smtp_test_failed", "settings", null, check.error);
    return { ok: false, message: check.error };
  }
  try {
    await sendMail({
      to,
      subject: "Test email – Daw Zainelabideen website / رسالة اختبار",
      html: emailLayout(
        "SMTP is working · البريد يعمل",
        `<p>This test email confirms that the website can send notifications.</p><p dir="rtl">تؤكد هذه الرسالة أن الموقع قادر على إرسال الإشعارات.</p><p style="color:#52606D;font-size:13px">${new Date().toISOString()}</p>`,
      ),
    });
    await audit(user.id, "smtp_test", "settings", null, to);
    return { ok: true, message: "sent" };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await audit(user.id, "smtp_test_failed", "settings", null, msg);
    return { ok: false, message: msg };
  }
}

// ───────────── Password change for the signed-in staff member ─────────────

export async function changeOwnPassword(_prev: AdminResult, form: FormData): Promise<AdminResult> {
  const user = await requireStaff();
  const current = String(form.get("current") ?? "");
  const next = String(form.get("next") ?? "");
  const full = await db.user.findUnique({ where: { id: user.id } });
  if (!full || !(await verifyPassword(current, full.passwordHash))) return { ok: false, errors: { current: "invalid" } };
  if (next.length < 10) return { ok: false, errors: { next: "password" } };
  await db.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(next) } });
  await audit(user.id, "password_change", "user", user.id);
  return { ok: true, message: "saved" };
}
