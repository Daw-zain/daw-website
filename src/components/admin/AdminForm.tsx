"use client";

import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import type { AdminResult } from "@/app/admin/actions";
import { cn } from "@/lib/utils";

const ERR: Record<string, Record<string, string>> = {
  en: { required: "required", number: "must be a whole number", date: "invalid date", invalid: "invalid value", json: "invalid JSON", file: "file type or size not allowed", password: "at least 10 characters", email: "invalid email", exists: "already used", self: "you can't remove your own admin access", url: "must start with https://", tooLong: "too long" },
  ar: { required: "مطلوب", number: "يجب أن يكون رقمًا صحيحًا", date: "تاريخ غير صالح", invalid: "قيمة غير صالحة", json: "صيغة JSON غير صحيحة", file: "نوع الملف أو حجمه غير مسموح", password: "10 أحرف على الأقل", email: "بريد غير صالح", exists: "مستخدم مسبقًا", self: "لا يمكنك إزالة صلاحية المسؤول عن حسابك", url: "يجب أن يبدأ بـ https://", tooLong: "طويل جدًا" },
};

/**
 * Client wrapper for admin forms. Submits via a server action without resetting fields,
 * so nothing is lost on validation errors. Server actions redirect on success.
 */
export function AdminForm({
  action,
  children,
  labels,
  lang,
  submitLabel,
  errorTitle,
  className,
  multipart = false,
}: {
  action: (fd: FormData) => Promise<AdminResult | void>;
  children: ReactNode;
  labels: Record<string, string>;
  lang: "ar" | "en";
  submitLabel: string;
  errorTitle: string;
  className?: string;
  multipart?: boolean;
}) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<AdminResult | null>(null);
  const ref = useRef<HTMLFormElement>(null);

  useEffect(() => {
    const form = ref.current;
    if (!form) return;
    form.querySelectorAll("[aria-invalid]").forEach((el) => el.removeAttribute("aria-invalid"));
    for (const k of Object.keys(result?.errors ?? {})) {
      form.querySelectorAll(`[name="${k}"], [name="${k}__file"]`).forEach((el) => el.setAttribute("aria-invalid", "true"));
    }
    if (result && !result.ok) form.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [result]);

  return (
    <form
      ref={ref}
      encType={multipart ? "multipart/form-data" : undefined}
      className={cn("space-y-6", className)}
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        start(async () => {
          const r = await action(fd);
          if (r) setResult(r);
        });
      }}
    >
      {result && !result.ok && (
        <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
          <p className="font-semibold">{result.message && !result.errors ? result.message : errorTitle}</p>
          {result.errors && (
            <ul className="mt-2 list-disc ps-5">
              {Object.entries(result.errors).map(([k, v]) => (
                <li key={k}>
                  {labels[k] ?? k}: {ERR[lang][v] ?? v}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {result?.ok && result.message && <div className="rounded-xl bg-emerald-50 p-4 text-sm font-semibold text-emerald-800">✓</div>}
      {children}
      <div className="sticky bottom-0 -mx-1 flex gap-3 border-t border-line bg-mist/95 px-1 py-4 backdrop-blur">
        <button type="submit" disabled={pending} className="btn btn-primary">
          {pending && <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />}
          {submitLabel}
        </button>
      </div>
    </form>
  );
}

export function ConfirmButton({ action, label, confirm, className }: { action: () => Promise<void>; label: string; confirm: string; className?: string }) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      className={cn("btn btn-sm border border-rose-200 bg-white text-rose-700 hover:bg-rose-50", className)}
      onClick={() => {
        if (window.confirm(confirm)) start(() => action());
      }}
    >
      {label}
    </button>
  );
}

export function CopyButton({ text, label, done }: { text: string; label: string; done: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button
      type="button"
      className="btn btn-sm border border-line bg-white text-navy hover:border-brand"
      onClick={async () => {
        await navigator.clipboard.writeText(text.startsWith("/") ? window.location.origin + text : text);
        setOk(true);
        setTimeout(() => setOk(false), 1500);
      }}
    >
      {ok ? done : label}
    </button>
  );
}
