"use client";

import { useActionState, useId, useState } from "react";
import Link from "next/link";
import { completePasswordReset, learnerLogin, learnerRegister, requestPasswordReset, type FormState } from "@/app/actions/public";
import { Consent, Field, FormMeta, Submit, SuccessPanel, errText, type FormT } from "./FormKit";
import { WithQuery } from "@/components/WithQuery";
import { cn } from "@/lib/utils";
import type { Dictionary } from "@/dictionaries/en";

type A = Dictionary["account"];

function accountMsg(a: A, f: FormT, key?: string) {
  if (!key) return null;
  return (a as Record<string, string>)[key] ?? errText(f, key) ?? f.errors.generic;
}

function Alert({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
      {text}
    </p>
  );
}

function EyeIcon({ off, className }: { off?: boolean; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" />
      <circle cx="12" cy="12" r="3" />
      {off && <path d="M3 3l18 18" />}
    </svg>
  );
}

function strength(pw: string) {
  let s = 0;
  if (pw.length >= 8) s++;
  if (pw.length >= 12) s++;
  if (/[a-z؀-ۿ]/i.test(pw) && /\d/.test(pw)) s++;
  if (/[^\w\s]/.test(pw) || (/[a-z]/.test(pw) && /[A-Z]/.test(pw))) s++;
  return Math.min(4, s);
}

/** Password input with show/hide button and an optional strength meter */
function PasswordField({
  name,
  label,
  a,
  error,
  autoComplete,
  meter = false,
  hint,
}: {
  name: string;
  label: string;
  a: A;
  error?: string;
  autoComplete: string;
  meter?: boolean;
  hint?: string;
}) {
  const id = useId();
  const [show, setShow] = useState(false);
  const [value, setValue] = useState("");
  const s = strength(value);
  const labels = [a.strengthWeak, a.strengthWeak, a.strengthFair, a.strengthGood, a.strengthStrong];
  const colors = ["bg-rose-500", "bg-rose-500", "bg-amber-500", "bg-sky-600", "bg-emerald-600"];
  return (
    <div>
      <label htmlFor={id} className="field-label">
        {label}
        <span className="text-red-600"> *</span>
      </label>
      <div className="relative">
        <input
          id={id}
          name={name}
          type={show ? "text" : "password"}
          required
          dir="ltr"
          autoComplete={autoComplete}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          aria-invalid={!!error}
          aria-describedby={error ? `${id}-e` : hint ? `${id}-h` : undefined}
          className="field pe-12"
        />
        <button
          type="button"
          onClick={() => setShow((v) => !v)}
          aria-label={show ? a.hide : a.show}
          title={show ? a.hide : a.show}
          className="absolute end-2 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-lg text-slate transition hover:bg-mist hover:text-navy"
        >
          <EyeIcon off={show} className="h-5 w-5" />
        </button>
      </div>
      {meter && value && (
        <div className="mt-2 flex items-center gap-3" aria-live="polite">
          <div className="flex flex-1 gap-1">
            {[1, 2, 3, 4].map((i) => (
              <span key={i} className={cn("h-1.5 flex-1 rounded-full transition-colors", i <= s ? colors[s] : "bg-line")} />
            ))}
          </div>
          <span className="text-xs font-semibold text-slate">{labels[s]}</span>
        </div>
      )}
      {hint && !error && (
        <p id={`${id}-h`} className="mt-1 text-xs text-slate">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-e`} className="field-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

// ───────────── Sign in ─────────────

type LoginProps = { locale: string; a: A; f: FormT; next?: string };

/** ?next=/ar/… in the URL sends the learner back there after signing in */
export function LoginForm(props: LoginProps) {
  return <WithQuery fallback={<LoginInner {...props} />}>{(q) => <LoginInner {...props} next={props.next ?? q.get("next") ?? undefined} />}</WithQuery>;
}

function LoginInner({ locale, a, f, next }: LoginProps) {
  const [state, action] = useActionState<FormState, FormData>(learnerLogin, { ok: false });
  return (
    <form action={action} className="relative grid gap-5" noValidate>
      <FormMeta locale={locale} />
      <input type="hidden" name="next" value={next ?? ""} />
      <Alert text={state.ok ? null : accountMsg(a, f, state.message)} />
      <Field name="email" type="email" label={a.email} t={f} required dir="ltr" autoComplete="email" defaultValue={state.values?.email} />
      <div>
        <PasswordField name="password" label={a.password} a={a} autoComplete="current-password" />
        <div className="mt-2 text-end">
          <Link href={`/${locale}/account/forgot`} className="text-sm font-semibold text-brand hover:underline">
            {a.forgot}
          </Link>
        </div>
      </div>
      <Submit pendingText={f.submitting} className="w-full">
        {a.signIn}
      </Submit>
    </form>
  );
}

// ───────────── Create account ─────────────

export function RegisterForm({ locale, a, f }: { locale: string; a: A; f: FormT }) {
  const [state, action] = useActionState<FormState, FormData>(learnerRegister, { ok: false });
  const v = state.values ?? {};
  const e = (k: string) => {
    const key = state.errors?.[k];
    return key ? accountMsg(a, f, key) ?? undefined : undefined;
  };
  if (state.ok && state.message === "checkEmail")
    return (
      <SuccessPanel text={a.checkEmail}>
        <Link href={`/${locale}/account/login`} className="btn btn-outline mt-6">
          {a.backToLogin}
        </Link>
      </SuccessPanel>
    );
  return (
    <form action={action} className="relative grid gap-5" noValidate>
      <FormMeta locale={locale} />
      <Alert text={!state.ok && state.message && state.message !== "validation" ? accountMsg(a, f, state.message) : null} />
      <Field name="name" label={f.fullName} t={f} required autoComplete="name" defaultValue={v.name} error={e("name")} />
      <div className="grid gap-5 sm:grid-cols-2">
        <Field name="email" type="email" label={a.email} t={f} required dir="ltr" autoComplete="email" defaultValue={v.email} error={e("email")} />
        <Field name="phone" type="tel" label={f.phone} t={f} dir="ltr" autoComplete="tel" defaultValue={v.phone} error={e("phone")} />
      </div>
      <PasswordField name="password" label={a.password} a={a} autoComplete="new-password" meter hint={a.passwordHint} error={e("password")} />
      <PasswordField name="confirm" label={a.confirmPassword} a={a} autoComplete="new-password" error={e("confirm")} />
      <Consent t={f} locale={locale} error={e("consent")} />
      <Submit pendingText={f.submitting} className="w-full">
        {a.createAccount}
      </Submit>
    </form>
  );
}

// ───────────── Forgot / reset password ─────────────

export function ForgotForm({ locale, a, f }: { locale: string; a: A; f: FormT }) {
  const [state, action] = useActionState<FormState, FormData>(requestPasswordReset, { ok: false });
  if (state.ok)
    return (
      <SuccessPanel text={a.resetSent}>
        <Link href={`/${locale}/account/login`} className="btn btn-outline mt-6">
          {a.backToLogin}
        </Link>
      </SuccessPanel>
    );
  return (
    <form action={action} className="relative grid gap-5" noValidate>
      <FormMeta locale={locale} />
      <Alert text={state.message ? accountMsg(a, f, state.message) : null} />
      <Field
        name="email"
        type="email"
        label={a.accountEmail}
        t={f}
        required
        dir="ltr"
        autoComplete="email"
        defaultValue={state.values?.email}
        error={state.errors?.email ? errText(f, state.errors.email) : undefined}
      />
      <Submit pendingText={f.submitting} className="w-full">
        {a.sendLink}
      </Submit>
    </form>
  );
}

export function ResetForm({ locale, a, f }: { locale: string; a: A; f: FormT }) {
  const [state, action] = useActionState<FormState, FormData>(completePasswordReset, { ok: false });
  const e = (k: string) => {
    const key = state.errors?.[k];
    return key ? accountMsg(a, f, key) ?? undefined : undefined;
  };
  if (state.ok)
    return (
      <SuccessPanel text={a.resetDone}>
        <Link href={`/${locale}/account`} className="btn btn-primary mt-6">
          {a.goToAccount}
        </Link>
      </SuccessPanel>
    );
  return (
    <form action={action} className="relative grid gap-5" noValidate>
      <FormMeta locale={locale} />
      <Alert text={state.message && state.message !== "validation" ? accountMsg(a, f, state.message) : null} />
      {state.message === "resetExpired" && (
        <Link href={`/${locale}/account/forgot`} className="-mt-2 text-sm font-semibold text-brand hover:underline">
          {a.forgotTitle}
        </Link>
      )}
      <PasswordField name="password" label={a.newPassword} a={a} autoComplete="new-password" meter hint={a.passwordHint} error={e("password")} />
      <PasswordField name="confirm" label={a.confirmPassword} a={a} autoComplete="new-password" error={e("confirm")} />
      <Submit pendingText={f.submitting} className="w-full">
        {a.savePassword}
      </Submit>
    </form>
  );
}
