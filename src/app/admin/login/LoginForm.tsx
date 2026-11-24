"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { adminLogin, type AdminResult } from "../actions";

function Btn({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button className="btn btn-primary w-full" disabled={pending}>
      {pending && <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />}
      {label}
    </button>
  );
}

export function AdminLoginForm({ labels }: { labels: Record<"email" | "password" | "login" | "invalidLogin" | "tooMany", string> }) {
  const [state, action] = useActionState<AdminResult, FormData>(adminLogin, { ok: false });
  return (
    <form action={action} className="space-y-4">
      {state.message && (
        <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {labels[state.message as "invalidLogin" | "tooMany"] ?? labels.invalidLogin}
        </p>
      )}
      <div>
        <label htmlFor="email" className="field-label">
          {labels.email}
        </label>
        <input id="email" name="email" type="email" required autoComplete="username" dir="ltr" className="field" />
      </div>
      <div>
        <label htmlFor="password" className="field-label">
          {labels.password}
        </label>
        <input id="password" name="password" type="password" required autoComplete="current-password" dir="ltr" className="field" />
      </div>
      <Btn label={labels.login} />
    </form>
  );
}
