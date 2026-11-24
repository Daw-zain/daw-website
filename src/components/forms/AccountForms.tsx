"use client";

import { useActionState } from "react";
import { learnerLogin, learnerRegister, type FormState } from "@/app/actions/public";
import { Consent, Field, FormMeta, Submit, errText, type FormT } from "./FormKit";
import type { Dictionary } from "@/dictionaries/en";

type A = Dictionary["account"];

function accountMsg(a: A, f: FormT, key?: string) {
  if (!key) return null;
  return (a as Record<string, string>)[key] ?? errText(f, key) ?? f.errors.generic;
}

export function LoginForm({ locale, a, f, next }: { locale: string; a: A; f: FormT; next?: string }) {
  const [state, action] = useActionState<FormState, FormData>(learnerLogin, { ok: false });
  return (
    <form action={action} className="grid gap-5" noValidate>
      <FormMeta locale={locale} />
      <input type="hidden" name="next" value={next ?? ""} />
      {state.message && (
        <p role="alert" className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {accountMsg(a, f, state.message)}
        </p>
      )}
      <Field name="email" type="email" label={f.email} t={f} required dir="ltr" autoComplete="email" defaultValue={state.values?.email} />
      <Field name="password" type="password" label={a.password} t={f} required autoComplete="current-password" />
      <Submit pendingText={f.submitting}>{a.signIn}</Submit>
    </form>
  );
}

export function RegisterForm({ locale, a, f }: { locale: string; a: A; f: FormT }) {
  const [state, action] = useActionState<FormState, FormData>(learnerRegister, { ok: false });
  const v = state.values ?? {};
  const e = (k: string) => {
    const key = state.errors?.[k];
    return key ? accountMsg(a, f, key) ?? undefined : undefined;
  };
  return (
    <form action={action} className="relative grid gap-5" noValidate>
      <FormMeta locale={locale} />
      {state.message && state.message !== "validation" && (
        <p role="alert" className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {accountMsg(a, f, state.message)}
        </p>
      )}
      <Field name="name" label={f.fullName} t={f} required autoComplete="name" defaultValue={v.name} error={e("name")} />
      <Field name="email" type="email" label={f.email} t={f} required dir="ltr" autoComplete="email" defaultValue={v.email} error={e("email")} />
      <Field name="password" type="password" label={a.password} t={f} required minLength={8} autoComplete="new-password" error={e("password")} />
      <Field name="confirm" type="password" label={a.confirmPassword} t={f} required autoComplete="new-password" error={e("confirm")} />
      <Consent t={f} locale={locale} error={e("consent")} />
      <Submit pendingText={f.submitting}>{a.createAccount}</Submit>
    </form>
  );
}
