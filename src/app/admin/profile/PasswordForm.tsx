"use client";

import { useActionState } from "react";
import { changeOwnPassword, type AdminResult } from "../actions";

export function PasswordForm({ labels }: { labels: Record<"current" | "next" | "save" | "ok" | "invalid" | "short", string> }) {
  const [state, action, pending] = useActionState<AdminResult, FormData>(changeOwnPassword, { ok: false });
  return (
    <form action={action} className="mt-4 space-y-4">
      {state.ok && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{labels.ok}</p>}
      {state.errors?.current && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{labels.invalid}</p>}
      {state.errors?.next && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{labels.short}</p>}
      <div>
        <label htmlFor="current" className="field-label">
          {labels.current}
        </label>
        <input id="current" name="current" type="password" required autoComplete="current-password" className="field" dir="ltr" />
      </div>
      <div>
        <label htmlFor="next" className="field-label">
          {labels.next}
        </label>
        <input id="next" name="next" type="password" required minLength={10} autoComplete="new-password" className="field" dir="ltr" />
      </div>
      <button className="btn btn-primary" disabled={pending}>
        {labels.save}
      </button>
    </form>
  );
}
