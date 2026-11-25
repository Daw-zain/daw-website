import { z } from "zod";
import { CONTACT_METHODS, SECTORS, SESSION_MODES, isLocale } from "./constants";

/** Validation shared by the server actions (local/admin mode) and the static (GitHub Pages + Supabase) actions. */

export type FormState = {
  ok: boolean;
  /** dictionary key under forms.errors / forms.success / newsletter / account */
  message?: string;
  errors?: Record<string, string>;
  /** echo back values so the form keeps them after an error */
  values?: Record<string, string>;
};

const phoneRe = /^[+\d][\d\s()-]{6,20}$/;
const str = (max = 200) => z.string().trim().max(max);
const req = (max = 200) => str(max).min(1, "required");
export const emailSchema = z.string().trim().toLowerCase().min(1, "required").email("email").max(200);
const phone = z.string().trim().min(1, "required").regex(phoneRe, "phone");
const optPhone = z.string().trim().max(30).refine((v) => v === "" || phoneRe.test(v), "phone");
const consent = z.literal("on", { errorMap: () => ({ message: "consent" }) });

export function zodErrors(err: z.ZodError) {
  const out: Record<string, string> = {};
  for (const i of err.issues) {
    const k = String(i.path[0]);
    if (!out[k]) out[k] = i.message === "Required" || i.code === "invalid_type" ? "required" : i.message;
  }
  return out;
}

export function formValues(form: FormData) {
  const v: Record<string, string> = {};
  form.forEach((val, key) => {
    if (typeof val === "string" && !key.startsWith("_") && key !== "website" && !key.includes("password") && key !== "confirm")
      v[key] = v[key] ? `${v[key]}, ${val}` : val;
  });
  return v;
}

export const formLocale = (form: FormData) => {
  const l = String(form.get("_locale") ?? "ar");
  return isLocale(l) ? l : "ar";
};

export const registrationSchema = z.object({
  programId: req(40),
  sessionId: str(40).optional(),
  fullName: req(120),
  email: emailSchema,
  phone,
  organization: str(150).optional(),
  jobTitle: str(120).optional(),
  city: str(80).optional(),
  notes: str(2000).optional(),
  consent,
});

export const consultationSchema = z.object({
  serviceId: str(40).optional(),
  name: req(120),
  email: emailSchema,
  phone: optPhone.optional(),
  organization: str(150).optional(),
  description: req(3000),
  contactMethod: z.enum(CONTACT_METHODS),
  preferredDate: str(40).optional(),
  consent,
});

export const corporateSchema = z.object({
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
  email: emailSchema,
  phone,
  notes: str(3000).optional(),
  consent,
});

export const contactSchema = z.object({
  name: req(120),
  email: emailSchema,
  phone: optPhone.optional(),
  subject: req(200),
  message: req(5000),
  consent,
});

export const loginSchema = z.object({ email: emailSchema, password: z.string().min(1, "required").max(200) });

export const registerSchema = z.object({
  name: req(120),
  email: emailSchema,
  phone: optPhone.optional(),
  password: z.string().min(8, "weak").max(200),
  confirm: z.string(),
  consent,
});

export const resetSchema = z.object({ password: z.string().min(8, "weak").max(200), confirm: z.string() });

/** Safe in-site redirect target from a ?next= value */
export function safeNext(next: string | null | undefined, fallback: string) {
  const n = String(next ?? "");
  return n.startsWith("/") && !n.startsWith("//") ? n : fallback;
}
