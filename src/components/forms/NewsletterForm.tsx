"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { subscribeNewsletter, type FormState } from "@/app/actions/public";
import { FormMeta } from "./FormKit";
import type { Dictionary } from "@/dictionaries/en";
import { cn } from "@/lib/utils";

function Btn({ label, dark }: { label: string; dark?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={cn("btn shrink-0", dark ? "btn-gold" : "btn-primary")}>
      {pending ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-current/30 border-t-current" aria-hidden="true" /> : null}
      {label}
    </button>
  );
}

export function NewsletterForm({ locale, t, errors, dark = false }: { locale: string; t: Dictionary["newsletter"]; errors: Dictionary["forms"]["errors"]; dark?: boolean }) {
  const [state, action] = useActionState<FormState, FormData>(subscribeNewsletter, { ok: false });
  const msg =
    state.ok && state.message
      ? (t as Record<string, string>)[state.message]
      : state.errors?.email
        ? errors.email
        : state.message
          ? (errors as Record<string, string>)[state.message] ?? errors.generic
          : null;

  return (
    <form action={action} className="relative w-full" noValidate>
      <FormMeta locale={locale} />
      {state.ok ? (
        <p role="status" className={cn("rounded-xl px-4 py-3 text-sm font-medium", dark ? "bg-white/10 text-white" : "bg-emerald-50 text-emerald-800")}>
          {msg}
        </p>
      ) : (
        <>
          <div className="flex flex-col gap-2 sm:flex-row">
            <label htmlFor={`nl-${dark ? "d" : "l"}`} className="sr-only">
              {t.placeholder}
            </label>
            <input
              id={`nl-${dark ? "d" : "l"}`}
              type="email"
              name="email"
              required
              dir="ltr"
              autoComplete="email"
              placeholder={t.placeholder}
              defaultValue={state.values?.email}
              className={cn(
                "field flex-1 text-start",
                dark && "border-white/15 bg-white/10 text-white placeholder:text-white/50 focus:border-gold focus:ring-gold/20",
              )}
            />
            <Btn label={t.subscribe} dark={dark} />
          </div>
          {msg && (
            <p role="alert" className={cn("mt-2 text-sm", dark ? "text-red-200" : "text-red-600")}>
              {msg}
            </p>
          )}
        </>
      )}
    </form>
  );
}
