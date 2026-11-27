"use client";

import { useState } from "react";
import { ExamError, utcDate } from "@/lib/exams/client";
import { AccountError, type Subscription } from "@/lib/exams/people";
import { untilDay } from "@/lib/exams/days";
import { cn } from "@/lib/utils";
import { Notice, type ExamLabels } from "@/components/exams/ExamShell";

export type Flash = { tone: "success" | "error" | "info"; text: string } | null;

/** the message of any failure: server function, database function or file */
export function peopleError(e: unknown, labels: ExamLabels): string {
  const errors = labels.manage.people.errors as Record<string, string>;
  if (e instanceof AccountError) return errors[e.code] ?? labels.errorGeneric;
  if (e instanceof ExamError) {
    const detail = e.message.match(/invalid_(?:profile|enrollment|account): ([a-z_0-9]+)/)?.[1];
    if (detail && errors[detail]) return errors[detail];
    if (/rate_limited/.test(e.message)) return errors.rate_limited;
    return (labels.admin.errors as Record<string, string>)[e.code] ?? labels.errorGeneric;
  }
  return labels.errorGeneric;
}

export const day = (v: string | null | undefined, locale: string) => utcDate(v)?.toLocaleDateString(locale === "ar" ? "ar-LY" : "en-GB", { dateStyle: "medium" }) ?? "—";
export const moment = (v: string | null | undefined, locale: string) => utcDate(v)?.toLocaleString(locale === "ar" ? "ar-LY" : "en-GB", { dateStyle: "medium", timeStyle: "short" }) ?? "—";

export type SubState = "open" | "expired" | "notStarted" | "SUSPENDED" | "COMPLETED" | "CANCELLED";
export function subState(s: Pick<Subscription, "status" | "open" | "expiresAt">): SubState {
  if (s.open) return "open";
  if (s.status !== "ACTIVE") return s.status;
  return s.expiresAt && (utcDate(s.expiresAt)?.getTime() ?? 0) <= Date.now() ? "expired" : "notStarted";
}
export const subLabel = (s: SubState, labels: ExamLabels) => (s === "open" || s === "expired" || s === "notStarted" ? labels.manage.member.subscriptions[s] : labels.admin.enrollmentStatus[s]);

export function SubBadge({ s, labels, locale }: { s: Subscription; labels: ExamLabels; locale: string }) {
  const state = subState(s);
  const last = untilDay(s.expiresAt);
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-semibold", state === "open" ? "bg-emerald-50 text-emerald-700" : "bg-gold/10 text-gold-600")} title={last ? `${labels.manage.people.cols.validUntil}: ${day(`${last}T12:00:00`, locale)}` : undefined}>
      <bdi dir="ltr">{s.code}</bdi> · {subLabel(state, labels)}
    </span>
  );
}

/** a one-time password link: shown once, copied by the administrator and sent to the person */
export function LinkBox({ link, email, labels, onClose }: { link: string; email: string; labels: ExamLabels; onClose: () => void }) {
  const f = labels.manage.people.form;
  const [copied, setCopied] = useState(false);
  return (
    <Notice tone="info">
      <p className="font-semibold">
        {f.linkTitle} <bdi dir="ltr">{email}</bdi>
      </p>
      <p>{f.linkText}</p>
      <input readOnly value={link} dir="ltr" onFocus={(e) => e.currentTarget.select()} className="field mt-2 w-full text-xs" aria-label={f.linkTitle} />
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={() => navigator.clipboard.writeText(link).then(() => setCopied(true)).catch(() => setCopied(false))}
        >
          {copied ? f.copied : f.copy}
        </button>
        <button type="button" className="btn btn-outline btn-sm" onClick={onClose}>{f.close}</button>
      </div>
    </Notice>
  );
}

export function download(name: string, data: BlobPart, mime: string) {
  const url = URL.createObjectURL(new Blob([data], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
export const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
export const CSV_MIME = "text/csv;charset=utf-8";
export const stamp = () => new Date().toISOString().slice(0, 10);
