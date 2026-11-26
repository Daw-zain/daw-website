"use client";

/**
 * Phase 10 — advanced question types (learner side + shared views):
 *   • HotspotBoard / HotspotInput — click places on an image (marks in % of the image)
 *   • DragDropInput — drag items into zones (or tap an item, then "place here")
 *   • ClozeInput — drop-downs / typed blanks inside a passage ([[id]] markers)
 *   • FigureView — the table or chart of a graphic-based question
 * Nothing here knows the answer: areas are only drawn when a caller passes them (staff key, released review).
 */
import { useEffect, useState, type MouseEvent as RME } from "react";
import type { Figure, Region } from "@/lib/exams/bank";
import { txt, type AssetRef, type Mark, type PublicQuestion, type Response } from "@/lib/exams/attempt";
import { cn } from "@/lib/utils";
import type { ExamLabels } from "./ExamShell";
import { signedUrls } from "./AssetManager";

/** one signed (expiring) URL for a private image */
export function useSignedOne(path: string | null | undefined) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    if (!path) return setUrl(null);
    signedUrls([path], 1800).then((u) => live && setUrl(u[path] ?? null));
    return () => {
      live = false;
    };
  }, [path]);
  return url;
}

const pct = (n: number) => `${Math.max(0, Math.min(100, n))}%`;

/* ───────────── hotspot ───────────── */

export function HotspotBoard({
  url,
  marks = [],
  regions,
  onAdd,
  onRemove,
  disabled,
  alt,
  labels,
}: {
  url: string | null;
  marks?: Mark[];
  regions?: Region[];
  onAdd?: (m: Mark) => void;
  onRemove?: (i: number) => void;
  disabled?: boolean;
  alt: string;
  labels: ExamLabels;
}) {
  if (!url) return <p className="rounded-xl bg-mist px-4 py-6 text-center text-sm text-slate">{labels.attempt.noImage}</p>;
  const click = (e: RME<HTMLDivElement>) => {
    if (disabled || !onAdd) return;
    const box = e.currentTarget.getBoundingClientRect();
    onAdd({ x: Math.round(((e.clientX - box.left) / box.width) * 10000) / 100, y: Math.round(((e.clientY - box.top) / box.height) * 10000) / 100 });
  };
  return (
    <div dir="ltr" className="overflow-x-auto">
      <div className={cn("relative mx-auto w-fit max-w-full select-none", onAdd && !disabled && "cursor-crosshair")} onClick={click}>
        {/* eslint-disable-next-line @next/next/no-img-element -- signed URL from private storage */}
        <img src={url} alt={alt} className="block h-auto max-h-[70vh] w-auto max-w-full rounded-lg" draggable={false} />
        {regions?.map((g, i) => (
          <span key={g.id} className="pointer-events-none absolute rounded border-2 border-dashed border-emerald-600 bg-emerald-400/20" style={{ left: pct(g.x), top: pct(g.y), width: pct(g.w), height: pct(g.h) }}>
            <span className="absolute -top-2.5 left-1 rounded bg-emerald-600 px-1 text-[10px] font-bold text-white">{i + 1}</span>
          </span>
        ))}
        {marks.map((m, i) => (
          <button
            key={i}
            type="button"
            disabled={disabled || !onRemove}
            onClick={(e) => {
              e.stopPropagation();
              onRemove?.(i);
            }}
            className="absolute grid h-7 w-7 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border-2 border-white bg-brand text-xs font-bold text-white shadow-md disabled:cursor-default"
            style={{ left: pct(m.x), top: pct(m.y) }}
            aria-label={`${labels.attempt.removeMark} ${i + 1}`}
          >
            {i + 1}
          </button>
        ))}
      </div>
    </div>
  );
}

export function HotspotInput({ data, value, onChange, disabled, locale, labels }: { data: PublicQuestion; value: Response; onChange: (r: Response) => void; disabled?: boolean; locale: string; labels: ExamLabels }) {
  const at = labels.attempt;
  const url = useSignedOne(data.hotspot?.path);
  const marks = value?.points ?? [];
  const n = data.selectCount ?? 1;
  const full = marks.length >= n;
  const set = (next: Mark[]) => onChange(next.length ? { points: next } : null);
  return (
    <div className="space-y-3">
      <p className="text-sm font-semibold text-brand">{at.markN.replace("{n}", String(n))}</p>
      <HotspotBoard url={url} marks={marks} disabled={disabled} alt={txt({ textAr: data.hotspot?.captionAr, textEn: data.hotspot?.captionEn }, locale) || at.hotspotImage} labels={labels} onAdd={full ? undefined : (m) => set([...marks, m])} onRemove={(i) => set(marks.filter((_, j) => j !== i))} />
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span className="text-slate" dir="ltr">{marks.length} / {n}</span>
        {full && !disabled && <span className="text-gold-600">{at.maxMarks}</span>}
        {marks.length > 0 && !disabled && <button type="button" onClick={() => set([])} className="btn btn-outline btn-sm">{at.clearMarks}</button>}
      </div>
    </div>
  );
}

/* ───────────── drag & drop ───────────── */

function DragChip({ id, label, selected, inZone, disabled, removeLabel, onPick, onReturn }: { id: string; label: string; selected: boolean; inZone: boolean; disabled?: boolean; removeLabel: string; onPick: () => void; onReturn: () => void }) {
  return (
    <span className={cn("inline-flex max-w-full items-center rounded-lg border bg-white text-sm shadow-sm", selected ? "border-brand ring-2 ring-brand/30" : "border-line")}>
      <button
        type="button"
        data-dnd
        draggable={!disabled}
        disabled={disabled}
        onDragStart={(e) => {
          e.dataTransfer.setData("text/plain", id);
          e.dataTransfer.effectAllowed = "move";
        }}
        onClick={onPick}
        aria-pressed={selected}
        className={cn("px-3 py-2 text-start leading-6", !disabled && "cursor-grab active:cursor-grabbing")}
      >
        {label}
      </button>
      {inZone && !disabled && (
        <button type="button" onClick={onReturn} className="px-2 py-2 text-slate hover:text-gold-600" aria-label={removeLabel}>
          ×
        </button>
      )}
    </span>
  );
}

export function DragDropInput({ data, value, onChange, disabled, locale, labels }: { data: PublicQuestion; value: Response; onChange: (r: Response) => void; disabled?: boolean; locale: string; labels: ExamLabels }) {
  const at = labels.attempt;
  const place = value?.place ?? {};
  const [sel, setSel] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const items = data.items ?? [];
  const put = (item: string, zone: string | null) => {
    const next = { ...place };
    if (zone) next[item] = zone;
    else delete next[item];
    setSel(null);
    onChange(Object.keys(next).length ? { place: next } : null);
  };
  const drop = (zone: string | null) => ({
    onDragOver: (e: React.DragEvent) => {
      if (disabled) return;
      e.preventDefault();
      setOver(zone ?? "__pool");
    },
    onDragLeave: () => setOver(null),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      setOver(null);
      const id = e.dataTransfer.getData("text/plain");
      if (!disabled && items.some((i) => i.id === id)) put(id, zone);
    },
  });
  const chip = (id: string, inZone: boolean) => (
    <DragChip key={id} id={id} label={txt(items.find((i) => i.id === id), locale)} selected={sel === id} inZone={inZone} disabled={disabled} removeLabel={at.removeItem} onPick={() => setSel(sel === id ? null : id)} onReturn={() => put(id, null)} />
  );
  const pool = items.filter((i) => !place[i.id]);
  return (
    <div className="space-y-4">
      <p className="text-sm text-slate">{at.dragHint}</p>
      <div {...drop(null)} className={cn("min-h-[3.5rem] rounded-xl border-2 border-dashed p-3", over === "__pool" ? "border-brand bg-brand/5" : "border-line bg-mist/50")}>
        <p className="mb-2 text-xs font-semibold text-slate">{at.pool}</p>
        <div className="flex flex-wrap gap-2">
          {pool.map((i) => chip(i.id, false))}
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {(data.zones ?? []).map((z) => {
          const inside = items.filter((i) => place[i.id] === z.id);
          return (
            <div key={z.id} {...drop(z.id)} className={cn("min-h-[6rem] rounded-xl border-2 p-3 transition", over === z.id ? "border-brand bg-brand/5" : "border-line bg-white")}>
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="font-semibold text-navy">{txt(z, locale)}</p>
                {sel && !disabled && (
                  <button type="button" onClick={() => put(sel, z.id)} className="btn btn-primary btn-sm">
                    {at.placeHere}
                  </button>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                {inside.length ? inside.map((i) => chip(i.id, true)) : <span className="text-xs text-slate">{at.dropHere}</span>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ───────────── cloze ───────────── */

/** passage split into text and [[id]] markers */
export const clozeParts = (text: string) => text.split(/\[\[([^\]]+)\]\]/);
export const clozeText = (d: { textAr?: string; textEn?: string }, locale: string) => (locale === "ar" ? d.textAr || d.textEn : d.textEn || d.textAr) ?? "";

export function ClozeInput({ data, value, onChange, disabled, locale, labels }: { data: PublicQuestion; value: Response; onChange: (r: Response) => void; disabled?: boolean; locale: string; labels: ExamLabels }) {
  const at = labels.attempt;
  const vals = value?.blanks ?? {};
  const byId = Object.fromEntries((data.blanks ?? []).map((b) => [b.id, b]));
  const set = (id: string, v: string) => {
    const next = { ...vals };
    if (v === "") delete next[id];
    else next[id] = v;
    onChange(Object.keys(next).length ? { blanks: next } : null);
  };
  const parts = clozeParts(clozeText(data, locale));
  return (
    <p className="whitespace-pre-line text-[17px] leading-[3rem]">
      {parts.map((p, i) => {
        if (i % 2 === 0) return <span key={i}>{p}</span>;
        const b = byId[p];
        const label = at.blankN.replace("{n}", p);
        if (!b) return <span key={i}>[[{p}]]</span>;
        return b.kind === "SELECT" ? (
          <select key={i} value={vals[p] ?? ""} disabled={disabled} onChange={(e) => set(p, e.target.value)} aria-label={label} className="field mx-1 inline-block w-auto max-w-full py-1.5 align-middle">
            <option value="">{at.selectMatch}</option>
            {(b.options ?? []).map((o) => (
              <option key={o.id} value={o.id}>
                {txt(o, locale)}
              </option>
            ))}
          </select>
        ) : (
          <input key={i} value={vals[p] ?? ""} disabled={disabled} maxLength={200} onChange={(e) => set(p, e.target.value)} aria-label={label} className="field mx-1 inline-block w-44 py-1.5 align-middle" />
        );
      })}
    </p>
  );
}

/* ───────────── graphic-based: table / chart ───────────── */

const COLORS = ["#1f6feb", "#c47f17", "#16a34a", "#9333ea", "#dc2626", "#0891b2", "#4b5563", "#db2777", "#65a30d"];

export function FigureTable({ rows }: { rows: string[][] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[20rem] border-collapse text-sm">
        <thead>
          <tr>{rows[0]?.map((h, i) => <th key={i} className="border border-line bg-mist px-3 py-2 text-start font-semibold text-navy">{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.slice(1).map((r, i) => (
            <tr key={i}>{r.map((c, k) => <td key={k} className="border border-line px-3 py-2">{c}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Chart({ f }: { f: Figure }) {
  const head = f.rows[0] ?? [];
  const data = f.rows.slice(1);
  const labels = data.map((r) => r[0]);
  const series = head.slice(1).map((name, s) => ({ name, values: data.map((r) => Number(r[s + 1]) || 0) }));
  const W = 640;
  const H = 320;
  const L = 56;
  const B = 44;
  const T = 16;
  const R = 16;

  if (f.kind === "PIE") {
    const vals = series[0]?.values ?? [];
    const sum = vals.reduce((a, b) => a + b, 0) || 1;
    let a0 = -Math.PI / 2;
    const cx = 160;
    const cy = H / 2;
    const rad = 130;
    return (
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={series[0]?.name}>
        {vals.map((v, i) => {
          const a1 = a0 + (v / sum) * Math.PI * 2;
          const large = a1 - a0 > Math.PI ? 1 : 0;
          const d = vals.length === 1 || v === sum ? `M ${cx - rad} ${cy} a ${rad} ${rad} 0 1 0 ${rad * 2} 0 a ${rad} ${rad} 0 1 0 ${-rad * 2} 0` : `M ${cx} ${cy} L ${cx + rad * Math.cos(a0)} ${cy + rad * Math.sin(a0)} A ${rad} ${rad} 0 ${large} 1 ${cx + rad * Math.cos(a1)} ${cy + rad * Math.sin(a1)} Z`;
          a0 = a1;
          return <path key={i} d={d} fill={COLORS[i % COLORS.length]} stroke="#fff" strokeWidth={2} />;
        })}
        {labels.map((l, i) => (
          <g key={i} transform={`translate(330 ${30 + i * 26})`}>
            <rect width={14} height={14} rx={3} fill={COLORS[i % COLORS.length]} />
            <text x={22} y={12} fontSize={14} fill="#1e293b">{`${l} — ${vals[i]} (${Math.round((vals[i] / sum) * 1000) / 10}%)`}</text>
          </g>
        ))}
      </svg>
    );
  }

  const all = series.flatMap((s) => s.values);
  const max = Math.max(0, ...all);
  const min = Math.min(0, ...all);
  const span = max - min || 1;
  const y = (v: number) => T + (H - T - B) * (1 - (v - min) / span);
  const plotW = W - L - R;
  const slot = plotW / Math.max(1, labels.length);
  const ticks = Array.from({ length: 5 }, (_, i) => min + (span * i) / 4);
  const fmt = (v: number) => (Math.abs(v) >= 1000 ? v.toLocaleString("en") : String(Math.round(v * 100) / 100));
  return (
    <svg viewBox={`0 0 ${W} ${H + (series.length > 1 ? 28 : 0)}`} className="h-auto w-full" role="img" aria-label={head.join(", ")}>
      {ticks.map((t, i) => (
        <g key={i}>
          <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke="#e2e8f0" />
          <text x={L - 8} y={y(t) + 4} fontSize={12} textAnchor="end" fill="#64748b">{fmt(t)}</text>
        </g>
      ))}
      <line x1={L} x2={W - R} y1={y(0)} y2={y(0)} stroke="#94a3b8" />
      {labels.map((l, i) => (
        <text key={i} x={L + slot * (i + 0.5)} y={H - B + 20} fontSize={12} textAnchor="middle" fill="#334155">{l.length > 14 ? `${l.slice(0, 13)}…` : l}</text>
      ))}
      {f.kind === "BAR" &&
        series.map((s, k) => {
          const bw = (slot * 0.7) / series.length;
          return s.values.map((v, i) => {
            const x = L + slot * i + slot * 0.15 + bw * k;
            return (
              <g key={`${k}-${i}`}>
                <rect x={x} y={Math.min(y(v), y(0))} width={Math.max(1, bw - 2)} height={Math.abs(y(v) - y(0))} fill={COLORS[k % COLORS.length]} rx={2} />
                {series.length * labels.length <= 24 && <text x={x + bw / 2 - 1} y={(v >= 0 ? y(v) - 4 : y(v) + 14)} fontSize={11} textAnchor="middle" fill="#334155">{fmt(v)}</text>}
              </g>
            );
          });
        })}
      {f.kind === "LINE" &&
        series.map((s, k) => (
          <g key={k}>
            <polyline fill="none" stroke={COLORS[k % COLORS.length]} strokeWidth={2.5} points={s.values.map((v, i) => `${L + slot * (i + 0.5)},${y(v)}`).join(" ")} />
            {s.values.map((v, i) => (
              <g key={i}>
                <circle cx={L + slot * (i + 0.5)} cy={y(v)} r={4} fill={COLORS[k % COLORS.length]} />
                {labels.length <= 12 && <text x={L + slot * (i + 0.5)} y={y(v) - 8} fontSize={11} textAnchor="middle" fill="#334155">{fmt(v)}</text>}
              </g>
            ))}
          </g>
        ))}
      {series.length > 1 &&
        series.map((s, k) => (
          <g key={k} transform={`translate(${L + k * 150} ${H + 6})`}>
            <rect width={12} height={12} rx={3} fill={COLORS[k % COLORS.length]} />
            <text x={18} y={11} fontSize={12} fill="#1e293b">{s.name}</text>
          </g>
        ))}
    </svg>
  );
}

export function FigureView({ figure, locale, labels }: { figure?: Figure | null; locale: string; labels: ExamLabels }) {
  if (!figure?.rows?.length) return null;
  const cap = locale === "ar" ? figure.captionAr || figure.captionEn : figure.captionEn || figure.captionAr;
  return (
    <figure className="mt-3 rounded-xl border border-line bg-white p-3">
      {figure.kind === "TABLE" ? (
        <FigureTable rows={figure.rows} />
      ) : (
        <>
          <div dir="ltr">
            <Chart f={figure} />
          </div>
          <details className="mt-1 text-sm">
            <summary className="cursor-pointer text-slate">{labels.attempt.showData}</summary>
            <div className="mt-2">
              <FigureTable rows={figure.rows} />
            </div>
          </details>
        </>
      )}
      {cap && <figcaption className="mt-2 text-sm text-slate">{cap}</figcaption>}
    </figure>
  );
}

/** visual answer for a hotspot question (learner marks + correct areas when known) */
export function HotspotAnswer({ data, response, regions, labels }: { data: PublicQuestion; response?: Response; regions?: Region[]; labels: ExamLabels }) {
  const url = useSignedOne(data.hotspot?.path);
  return <HotspotBoard url={url} marks={response?.points ?? []} regions={regions} disabled alt={labels.attempt.hotspotImage} labels={labels} />;
}
