/**
 * Static-site (GitHub Pages) replacements for the server actions in src/app/actions/public.ts.
 * The Pages build aliases "@/app/actions/public" to this file (see next.config.ts), so every form keeps
 * working without a server: requests are written straight to Supabase and learner accounts use Supabase Auth.
 * Same exported names and signatures as the server version.
 */
import {
  type FormState,
  consultationSchema,
  contactSchema,
  corporateSchema,
  emailSchema,
  formLocale as loc,
  formValues as values,
  loginSchema,
  registerSchema,
  registrationSchema,
  resetSchema,
  safeNext,
  zodErrors,
} from "@/lib/form-schemas";
import { withBase } from "@/lib/env-public";
import { randomHex, randomId, supabase } from "./supabase";

export type { FormState };

const now = () => new Date().toISOString();
const site = (path: string) => `${window.location.origin}${withBase(path)}`;
const slash = (p: string) => (p.endsWith("/") || p.includes("?") || p.includes("#") ? p : `${p}/`);
const go = (path: string) => window.location.assign(withBase(slash(path)));

/** honeypot + "filled in too fast" check (no server-side rate limit on a static site) */
function spam(form: FormData) {
  if (String(form.get("website") ?? "").trim()) return true;
  const ts = Number(form.get("_ts") ?? 0);
  return !ts || Date.now() - ts < 1500;
}

async function insert(table: string, row: Record<string, unknown>, form: FormData, success: string): Promise<FormState> {
  const { error } = await supabase().from(table).insert(row);
  if (error) {
    console.error(`[${table}]`, error.message);
    return { ok: false, message: "generic", values: values(form) };
  }
  return { ok: true, message: success };
}

const opt = (v?: string) => (v ? v : null);

export async function submitRegistration(_prev: FormState, form: FormData): Promise<FormState> {
  if (spam(form)) return { ok: false, message: "spam", values: values(form) };
  const parsed = registrationSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, message: "validation", errors: zodErrors(parsed.error), values: values(form) };
  const d = parsed.data;
  return insert(
    "Registration",
    {
      id: randomId(),
      programId: d.programId,
      sessionId: opt(d.sessionId),
      fullName: d.fullName,
      email: d.email,
      phone: d.phone,
      organization: opt(d.organization),
      jobTitle: opt(d.jobTitle),
      city: opt(d.city),
      notes: opt(d.notes),
      locale: loc(form),
      updatedAt: now(),
    },
    form,
    "registration",
  );
}

export async function submitConsultation(_prev: FormState, form: FormData): Promise<FormState> {
  if (spam(form)) return { ok: false, message: "spam", values: values(form) };
  const parsed = consultationSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, message: "validation", errors: zodErrors(parsed.error), values: values(form) };
  const d = parsed.data;
  if (d.contactMethod !== "EMAIL" && !d.phone) return { ok: false, message: "validation", errors: { phone: "required" }, values: values(form) };
  return insert(
    "ConsultationRequest",
    {
      id: randomId(),
      serviceId: opt(d.serviceId),
      name: d.name,
      email: d.email,
      phone: opt(d.phone),
      organization: opt(d.organization),
      description: d.description,
      contactMethod: d.contactMethod,
      preferredDate: opt(d.preferredDate),
      locale: loc(form),
      updatedAt: now(),
    },
    form,
    "consultation",
  );
}

export async function submitCorporate(_prev: FormState, form: FormData): Promise<FormState> {
  if (spam(form)) return { ok: false, message: "spam", values: values(form) };
  const progs = form.getAll("programs").map(String).filter(Boolean);
  const raw = { ...Object.fromEntries(form), programs: progs.join(", ") };
  delete (raw as Record<string, unknown>).attachment;
  const parsed = corporateSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, message: "validation", errors: zodErrors(parsed.error), values: values(form) };
  const d = parsed.data;
  return insert(
    "CorporateRequest",
    {
      id: randomId(),
      organization: d.organization,
      sector: d.sector,
      traineesCount: d.traineesCount ? Number(d.traineesCount) : null,
      programs: d.programs,
      mode: d.mode,
      duration: opt(d.duration),
      contactName: d.contactName,
      jobTitle: opt(d.jobTitle),
      email: d.email,
      phone: d.phone,
      notes: opt(d.notes),
      locale: loc(form),
      updatedAt: now(),
    },
    form,
    "corporate",
  );
}

export async function submitContact(_prev: FormState, form: FormData): Promise<FormState> {
  if (spam(form)) return { ok: false, message: "spam", values: values(form) };
  const parsed = contactSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, message: "validation", errors: zodErrors(parsed.error), values: values(form) };
  const d = parsed.data;
  return insert(
    "ContactMessage",
    { id: randomId(), name: d.name, email: d.email, phone: opt(d.phone), subject: d.subject, message: d.message, locale: loc(form), updatedAt: now() },
    form,
    "contact",
  );
}

export async function subscribeNewsletter(_prev: FormState, form: FormData): Promise<FormState> {
  if (spam(form)) return { ok: false, message: "spam", values: values(form) };
  const parsed = emailSchema.safeParse(form.get("email"));
  if (!parsed.success) return { ok: false, errors: { email: "email" }, values: values(form) };
  const { error } = await supabase()
    .from("Subscriber")
    .insert({ id: randomId(), email: parsed.data, token: randomHex(24), locale: loc(form) });
  if (error) {
    if (error.code === "23505") return { ok: true, message: "already" };
    console.error("[newsletter]", error.message);
    return { ok: false, message: "generic", values: values(form) };
  }
  return { ok: true, message: "thanks" };
}

export async function newsletterToken(action: string, token: string): Promise<"confirmed" | "unsubscribed" | "invalid"> {
  if (!/^[a-f0-9]{48}$/.test(token) || (action !== "confirm" && action !== "unsubscribe")) return "invalid";
  const { data, error } = await supabase().rpc("newsletter_action", { p_token: token, p_action: action });
  if (error || (data !== "confirmed" && data !== "unsubscribed")) return "invalid";
  return data;
}

// ───────────── Learner accounts (Supabase Auth) ─────────────

export async function learnerLogin(_prev: FormState, form: FormData): Promise<FormState> {
  const parsed = loginSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, message: "invalid", values: values(form) };
  const { error } = await supabase().auth.signInWithPassword({ email: parsed.data.email, password: parsed.data.password });
  if (error) {
    const notConfirmed = /confirm/i.test(error.message);
    return { ok: false, message: notConfirmed ? "notConfirmed" : "invalid", values: { email: parsed.data.email } };
  }
  go(safeNext(String(form.get("next") ?? ""), `/${loc(form)}/account`));
  return { ok: true };
}

export async function learnerRegister(_prev: FormState, form: FormData): Promise<FormState> {
  if (spam(form)) return { ok: false, message: "spam", values: values(form) };
  const parsed = registerSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, message: "validation", errors: zodErrors(parsed.error), values: values(form) };
  const d = parsed.data;
  if (d.password !== d.confirm) return { ok: false, errors: { confirm: "mismatch" }, values: values(form) };
  const l = loc(form);
  const { data, error } = await supabase().auth.signUp({
    email: d.email,
    password: d.password,
    options: { data: { name: d.name, phone: d.phone || null, locale: l }, emailRedirectTo: site(`/${l}/account/`) },
  });
  if (error) {
    if (/registered|exists/i.test(error.message)) return { ok: false, message: "exists", values: values(form) };
    if (/password/i.test(error.message)) return { ok: false, errors: { password: "weak" }, values: values(form) };
    console.error("[signup]", error.message);
    return { ok: false, message: "generic", values: values(form) };
  }
  // Supabase hides existing emails when confirmation is on: the user comes back with no identities.
  if (data.user && data.user.identities && data.user.identities.length === 0) return { ok: false, message: "exists", values: values(form) };
  if (data.session) {
    go(`/${l}/account`);
    return { ok: true };
  }
  return { ok: true, message: "checkEmail" };
}

export async function logout(form: FormData) {
  await supabase().auth.signOut();
  go(`/${loc(form)}`);
}

export async function requestPasswordReset(_prev: FormState, form: FormData): Promise<FormState> {
  const parsed = emailSchema.safeParse(form.get("email"));
  if (!parsed.success) return { ok: false, errors: { email: "email" }, values: values(form) };
  const { error } = await supabase().auth.resetPasswordForEmail(parsed.data, { redirectTo: site(`/${loc(form)}/account/reset/`) });
  if (error && /rate|seconds/i.test(error.message)) return { ok: false, message: "rate", values: values(form) };
  // Same answer whether or not the email has an account.
  return { ok: true, message: "resetSent" };
}

export async function completePasswordReset(_prev: FormState, form: FormData): Promise<FormState> {
  const parsed = resetSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, message: "validation", errors: zodErrors(parsed.error) };
  if (parsed.data.password !== parsed.data.confirm) return { ok: false, errors: { confirm: "mismatch" } };
  const { data } = await supabase().auth.getSession();
  if (!data.session) return { ok: false, message: "resetExpired" };
  const { error } = await supabase().auth.updateUser({ password: parsed.data.password });
  if (error) return { ok: false, message: /different|same/i.test(error.message) ? "samePassword" : "generic" };
  return { ok: true, message: "resetDone" };
}

// ───────────── Saved resources (kept in this browser, per learner) ─────────────

export const favKey = (userId: string) => `dz_fav:${userId}`;

export function readFavorites(userId: string): string[] {
  try {
    return JSON.parse(localStorage.getItem(favKey(userId)) || "[]");
  } catch {
    return [];
  }
}

export async function toggleFavorite(resourceId: string, _locale: string): Promise<{ saved: boolean } | { login: true }> {
  const { data } = await supabase().auth.getSession();
  const user = data.session?.user;
  if (!user) return { login: true };
  const list = readFavorites(user.id);
  const saved = !list.includes(resourceId);
  localStorage.setItem(favKey(user.id), JSON.stringify(saved ? [resourceId, ...list] : list.filter((x) => x !== resourceId)));
  return { saved };
}
