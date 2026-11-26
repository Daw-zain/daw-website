"use client";

/** Small charts of the reports pages (phase 12): one measure per chart, one hue, values always readable as text. */
import { useState } from "react";
import { cn } from "@/lib/utils";

export function Stat({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="card p-4">
      <p className="text-sm text-slate">{label}</p>
      <p className="mt-1 text-2xl font-bold text-navy" dir="ltr" style={{ textAlign: "start" }}>
        <bdi>{value}</bdi>
      </p>
      {hint && <p className="mt-1 text-xs text-slate">{hint}</p>}
    </div>
  );
}

export type BarRow = { key: string; label: string; value: number | null; text: string; note?: string; tone?: "good" | "plain" };

/** Horizontal bars of percentages (0–100); the value is written beside every bar. */
export function Bars({ rows, empty }: { rows: BarRow[]; empty: string }) {
  if (!rows.length) return <p className="text-sm text-slate">{empty}</p>;
  return (
    <ul className="space-y-3">
      {rows.map((r) => (
        <li key={r.key} title={`${r.label}: ${r.text}${r.note ? ` · ${r.note}` : ""}`} className="group">
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="min-w-0 break-words font-semibold text-navy">{r.label}</span>
            <span className="shrink-0 font-bold text-navy" dir="ltr">{r.text}</span>
          </div>
          <div className="mt-1 h-2.5 overflow-hidden rounded-full bg-mist" aria-hidden="true">
            <div className={cn("h-full rounded-full transition-opacity group-hover:opacity-80", r.tone === "good" ? "bg-emerald-600" : "bg-brand")} style={{ width: `${Math.max(0, Math.min(100, r.value ?? 0))}%` }} />
          </div>
          {r.note && <p className="mt-0.5 text-xs text-slate">{r.note}</p>}
        </li>
      ))}
    </ul>
  );
}

export type Column = { key: string; label: string; value: number; tip: string };

/**
 * Vertical columns over an ordered axis (score bands, dates). Numbers run left to right in both languages.
 * Hover / focus a column to read it; the largest value is labelled.
 */
export function Columns({ data, label, max: fixedMax, format = String }: { data: Column[]; label: string; max?: number; format?: (v: number) => string }) {
  const [active, setActive] = useState<number | null>(null);
  const max = fixedMax ?? Math.max(1, ...data.map((d) => d.value));
  const top = Math.max(...data.map((d) => d.value));
  const every = Math.ceil(data.length / 10);
  return (
    <figure dir="ltr" aria-label={label}>
      <div className="relative">
        <p className="h-6 truncate text-center text-xs font-semibold text-navy" aria-live="polite">
          <bdi>{active !== null && data[active] ? data[active].tip : ""}</bdi>
        </p>
        <ol className="flex h-40 items-end gap-0.5 border-b border-line">
          {data.map((d, i) => (
            <li key={d.key} className="flex h-full min-w-0 flex-1 items-end justify-center">
              <button
                type="button"
                aria-label={d.tip}
                onMouseEnter={() => setActive(i)}
                onMouseLeave={() => setActive(null)}
                onFocus={() => setActive(i)}
                onBlur={() => setActive(null)}
                onClick={() => setActive(i)}
                className="flex h-full w-full max-w-12 flex-col items-center justify-end"
              >
                {d.value > 0 && (d.value === top || active === i) && <span className="mb-0.5 text-[11px] font-semibold text-slate">{format(d.value)}</span>}
                <span className={cn("block w-full rounded-t", active === i ? "bg-navy" : "bg-brand")} style={{ height: `${(d.value / max) * 85}%`, minHeight: d.value > 0 ? 3 : 0 }} />
              </button>
            </li>
          ))}
        </ol>
        <ol className="flex gap-0.5 pt-1" aria-hidden="true">
          {data.map((d, i) => (
            <li key={d.key} className="min-w-0 flex-1 text-center text-[10px] leading-4 text-slate">
              {i % every === 0 ? d.label : ""}
            </li>
          ))}
        </ol>
      </div>
    </figure>
  );
}
