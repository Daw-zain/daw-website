"use client";

import { useActionState } from "react";
import { sendTestEmail, type AdminResult } from "../actions";

type Summary = { configured: boolean; host: string; port: string; secure: boolean; user: string; hasPassword: boolean; from: string };

export function SmtpTest({ summary, defaultTo, lang }: { summary: Summary; defaultTo: string; lang: "ar" | "en" }) {
  const [state, action, pending] = useActionState<AdminResult, FormData>(sendTestEmail, { ok: false });
  const ar = lang === "ar";
  const row = (k: string, v: string) => (
    <div className="flex justify-between gap-4 py-1.5 text-sm">
      <span className="text-slate">{k}</span>
      <span className="font-semibold text-navy" dir="ltr">
        {v || "—"}
      </span>
    </div>
  );
  return (
    <section className="rounded-2xl border border-line bg-white p-6">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-bold text-navy">{ar ? "البريد الإلكتروني (SMTP)" : "Email (SMTP)"}</h2>
        <span className={`chip ${summary.configured ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-800"}`}>
          {summary.configured ? (ar ? "مُعدّ" : "Configured") : ar ? "غير مُعدّ" : "Not configured"}
        </span>
      </div>
      <p className="mt-2 text-xs leading-5 text-slate">
        {ar
          ? "تُضبط إعدادات SMTP في ملف ‎.env‎ على الخادم (لأسباب أمنية لا تُحفظ كلمة المرور في قاعدة البيانات). بعد تعديلها أعد تشغيل الموقع."
          : "SMTP settings live in the server's .env file (the password is never stored in the database). Restart the site after changing them."}
      </p>
      <div className="mt-4 divide-y divide-line">
        {row("SMTP_HOST", summary.host)}
        {row("SMTP_PORT / SECURE", `${summary.port} / ${summary.secure ? "SSL (true)" : "STARTTLS (false)"}`)}
        {row("SMTP_USER", summary.user)}
        {row("SMTP_PASSWORD", summary.hasPassword ? "••••••••" : "")}
        {row("MAIL_FROM", summary.from)}
      </div>
      <form action={action} className="mt-5 flex flex-wrap items-end gap-3">
        <div className="min-w-56 flex-1">
          <label htmlFor="smtp-to" className="field-label">
            {ar ? "إرسال رسالة اختبار إلى" : "Send a test email to"}
          </label>
          <input id="smtp-to" name="to" type="email" required defaultValue={defaultTo} className="field" dir="ltr" />
        </div>
        <button className="btn btn-primary" disabled={pending}>
          {pending && <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />}
          {ar ? "إرسال اختبار" : "Send test"}
        </button>
      </form>
      {state.ok && <p className="mt-4 rounded-xl bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">✓ {ar ? "أُرسلت رسالة الاختبار. تحقق من صندوق الوارد (والرسائل غير المرغوب فيها)." : "Test email sent. Check the inbox (and spam folder)."}</p>}
      {!state.ok && state.message && (
        <p className="mt-4 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-800" dir="ltr">
          ✗ {state.message}
        </p>
      )}
    </section>
  );
}
