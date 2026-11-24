"use client";

import { useEffect, useId, useState, type ReactNode, type InputHTMLAttributes, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import type { Dictionary } from "@/dictionaries/en";
import type { FormState } from "@/app/actions/public";
import { CheckIcon } from "@/components/Icons";
import { cn } from "@/lib/utils";

export type FormT = Dictionary["forms"];

/** Hidden anti-spam + locale fields */
export function FormMeta({ locale }: { locale: string }) {
  const [ts, setTs] = useState("0");
  useEffect(() => setTs(String(Date.now())), []);
  return (
    <>
      <input type="hidden" name="_ts" value={ts} />
      <input type="hidden" name="_locale" value={locale} />
      <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label>
          Website
          <input type="text" name="website" tabIndex={-1} autoComplete="off" defaultValue="" />
        </label>
      </div>
    </>
  );
}

export function errText(t: FormT, key?: string) {
  if (!key) return undefined;
  return (t.errors as Record<string, string>)[key] ?? t.errors.required;
}

type FieldBase = { name: string; label: string; error?: string; hint?: string; required?: boolean; t: FormT; className?: string };

function Label({ id, label, required, t }: { id: string } & Pick<FieldBase, "label" | "required" | "t">) {
  return (
    <label htmlFor={id} className="field-label">
      {label}
      {required ? <span className="text-red-600"> *</span> : <span className="ms-1 text-xs font-normal text-slate">({t.optionalTag})</span>}
    </label>
  );
}

export function Field({ name, label, error, hint, required, t, className, ...rest }: FieldBase & InputHTMLAttributes<HTMLInputElement>) {
  const uid = useId();
  return (
    <div className={className}>
      <Label id={`f-${name}-${uid}`} label={label} required={required} t={t} />
      <input id={`f-${name}-${uid}`} name={name} required={required} aria-invalid={!!error} aria-describedby={error ? `e-${name}-${uid}` : undefined} className="field" {...rest} />
      {hint && !error && <p className="mt-1 text-xs text-slate">{hint}</p>}
      {error && (
        <p id={`e-${name}-${uid}`} className="field-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export function TextArea({ name, label, error, required, t, className, ...rest }: FieldBase & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const uid = useId();
  return (
    <div className={className}>
      <Label id={`f-${name}-${uid}`} label={label} required={required} t={t} />
      <textarea id={`f-${name}-${uid}`} name={name} required={required} rows={4} aria-invalid={!!error} aria-describedby={error ? `e-${name}-${uid}` : undefined} className="field resize-y" {...rest} />
      {error && (
        <p id={`e-${name}-${uid}`} className="field-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export function Select({
  name,
  label,
  error,
  required,
  t,
  className,
  options,
  placeholder,
  ...rest
}: FieldBase & SelectHTMLAttributes<HTMLSelectElement> & { options: { value: string; label: string; disabled?: boolean }[]; placeholder?: string }) {
  const uid = useId();
  return (
    <div className={className}>
      <Label id={`f-${name}-${uid}`} label={label} required={required} t={t} />
      <select id={`f-${name}-${uid}`} name={name} required={required} aria-invalid={!!error} aria-describedby={error ? `e-${name}-${uid}` : undefined} className="field appearance-auto" {...rest}>
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value} disabled={o.disabled}>
            {o.label}
          </option>
        ))}
      </select>
      {error && (
        <p id={`e-${name}-${uid}`} className="field-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export function Consent({ t, locale, error }: { t: FormT; locale: string; error?: string }) {
  return (
    <div>
      <label className="flex items-start gap-3 text-sm text-slate">
        <input type="checkbox" name="consent" required className="mt-0.5 h-5 w-5 shrink-0 rounded border-line accent-brand" aria-invalid={!!error} />
        <span>
          {t.consent}{" "}
          <Link href={`/${locale}/privacy`} className="font-semibold text-brand underline underline-offset-2" target="_blank">
            {t.privacyLink}
          </Link>
          .
        </span>
      </label>
      {error && <p className="field-error">{error}</p>}
    </div>
  );
}

export function Submit({ children, pendingText, className }: { children: ReactNode; pendingText: string; className?: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={cn("btn btn-primary group", className)}>
      {pending ? (
        <>
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" aria-hidden="true" />
          {pendingText}
        </>
      ) : (
        children
      )}
    </button>
  );
}

export function FormAlert({ state, t, successText }: { state: FormState; t: FormT; successText?: string }) {
  if (state.ok || !state.message) return null;
  return (
    <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
      {errText(t, state.message) ?? successText}
    </div>
  );
}

export function SuccessPanel({ text, children }: { text: string; children?: ReactNode }) {
  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        className="flex flex-col items-center rounded-2xl border border-emerald-200 bg-emerald-50/70 px-6 py-10 text-center"
        role="status"
        aria-live="polite"
      >
        <motion.span
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: "spring", stiffness: 260, damping: 16, delay: 0.1 }}
          className="mb-4 grid h-14 w-14 place-items-center rounded-full bg-emerald-600 text-white"
        >
          <CheckIcon className="h-7 w-7" />
        </motion.span>
        <p className="max-w-md text-lg font-semibold text-navy">{text}</p>
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
