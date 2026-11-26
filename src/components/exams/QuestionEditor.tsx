"use client";

import { useRef, useState, type ReactNode } from "react";
import { rpc } from "@/lib/exams/client";
import {
  bankErrorKey,
  blankQuestion,
  catName,
  FIGURE_KINDS,
  newItemId,
  QUESTION_TYPES,
  toSavePayload,
  type Category,
  type ClozeBlank,
  type ExamAsset,
  type Figure,
  type FigureKind,
  type Item,
  type Region,
  type QuestionFull,
  type QuestionType,
  type ScenarioSummary,
  type ScoringMode,
  title as scenarioTitle,
} from "@/lib/exams/bank";
import { AssetManager } from "./AssetManager";
import { Notice, type ExamLabels } from "./ExamShell";
import { QuestionPreview } from "./QuestionPreview";
import { FigureView, useSignedOne } from "./AdvancedQuestions";

const Field = ({ label, children, className = "" }: { label: string; children: ReactNode; className?: string }) => (
  <label className={`block text-sm ${className}`}>
    <span className="field-label">{label}</span>
    {children}
  </label>
);

function ItemRows({
  e,
  list,
  onChange,
  lead,
  reorder = false,
  min = 2,
}: {
  e: ExamLabels["bank"]["editor"];
    list: Item[];
    onChange: (next: Item[]) => void;
    lead?: (it: Item, i: number) => ReactNode;
    reorder?: boolean;
    min?: number;
}) {
  return (
    <div className="space-y-2">
      {list.map((it, i) => (
        <div key={it.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-white p-2">
          {lead?.(it, i)}
          <input
            value={it.textAr}
            onChange={(ev) => onChange(list.map((x) => (x.id === it.id ? { ...x, textAr: ev.target.value } : x)))}
            placeholder={e.optionAr}
            className="field min-w-0 flex-[2] basis-48 py-2"
            dir="rtl"
          />
          <input
            value={it.textEn}
            onChange={(ev) => onChange(list.map((x) => (x.id === it.id ? { ...x, textEn: ev.target.value } : x)))}
            placeholder={e.optionEn}
            className="field min-w-0 flex-1 basis-36 py-2"
            dir="ltr"
          />
          {reorder && (
            <span className="flex">
              <button type="button" disabled={i === 0} onClick={() => { const n = [...list]; [n[i - 1], n[i]] = [n[i], n[i - 1]]; onChange(n); }} className="rounded-lg px-2 py-1 text-slate hover:bg-mist disabled:opacity-30" aria-label={e.up}>↑</button>
              <button type="button" disabled={i === list.length - 1} onClick={() => { const n = [...list]; [n[i + 1], n[i]] = [n[i], n[i + 1]]; onChange(n); }} className="rounded-lg px-2 py-1 text-slate hover:bg-mist disabled:opacity-30" aria-label={e.down}>↓</button>
            </span>
          )}
          <button type="button" disabled={list.length <= min} onClick={() => onChange(list.filter((x) => x.id !== it.id))} className="rounded-lg px-2 py-1 text-sm text-gold-600 hover:bg-gold/10 disabled:opacity-30">
            {e.remove}
          </button>
        </div>
      ))}
      <button type="button" disabled={list.length >= 30} onClick={() => onChange([...list, { id: newItemId(), textAr: "", textEn: "" }])} className="btn btn-outline btn-sm">
        + {e.addOption}
      </button>
    </div>
  );
}

function ScoringSelect({ e, mode, modes, onChange }: { e: ExamLabels["bank"]["editor"]; mode: ScoringMode; modes: ScoringMode[]; onChange: (m: ScoringMode) => void }) {
  return (
    <Field label={e.scoring} className="max-w-md">
      <select value={mode} onChange={(ev) => onChange(ev.target.value as ScoringMode)} className="field">
        {modes.map((m) => (
          <option key={m} value={m}>
            {e.scoringModes[m]}
          </option>
        ))}
      </select>
    </Field>
  );
}

/* ───────────── phase 10 editors ───────────── */

const clamp = (n: number) => Math.max(0, Math.min(100, n));
const r2 = (n: number) => Math.round(n * 100) / 100;
const twoItems = (): Item[] => [{ id: newItemId(), textAr: "", textEn: "" }, { id: newItemId(), textAr: "", textEn: "" }];

/** draw the correct areas on the question's first image (drag to draw a rectangle) */
function HotspotEditor({ e, labels, url, regions, onChange }: { e: ExamLabels["bank"]["editor"]; labels: ExamLabels; url: string | null; regions: Region[]; onChange: (r: Region[]) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<{ x0: number; y0: number; x: number; y: number } | null>(null);
  const pos = (ev: React.PointerEvent) => {
    const b = box.current!.getBoundingClientRect();
    return { x: clamp(((ev.clientX - b.left) / b.width) * 100), y: clamp(((ev.clientY - b.top) / b.height) * 100) };
  };
  const rect = draft && { x: Math.min(draft.x0, draft.x), y: Math.min(draft.y0, draft.y), w: Math.abs(draft.x - draft.x0), h: Math.abs(draft.y - draft.y0) };
  if (!url) return <p className="rounded-xl bg-mist px-4 py-6 text-sm text-slate">{e.hotspotNoImage}</p>;
  return (
    <div className="space-y-3">
      <div dir="ltr" className="overflow-x-auto">
        <div
          ref={box}
          className="relative mx-auto w-fit max-w-full cursor-crosshair touch-none select-none"
          onPointerDown={(ev) => {
            if (regions.length >= 10) return;
            ev.currentTarget.setPointerCapture(ev.pointerId);
            const p = pos(ev);
            setDraft({ x0: p.x, y0: p.y, x: p.x, y: p.y });
          }}
          onPointerMove={(ev) => draft && setDraft({ ...draft, ...pos(ev) })}
          onPointerUp={() => {
            if (rect && rect.w >= 1 && rect.h >= 1) onChange([...regions, { id: newItemId(), x: r2(rect.x), y: r2(rect.y), w: r2(rect.w), h: r2(rect.h) }]);
            setDraft(null);
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- signed URL from private storage */}
          <img src={url} alt="" className="block h-auto max-h-[70vh] w-auto max-w-full rounded-lg" draggable={false} />
          {regions.map((g, i) => (
            <span key={g.id} className="pointer-events-none absolute rounded border-2 border-emerald-600 bg-emerald-400/25" style={{ left: `${g.x}%`, top: `${g.y}%`, width: `${g.w}%`, height: `${g.h}%` }}>
              <span className="absolute -top-2.5 left-1 rounded bg-emerald-600 px-1 text-[10px] font-bold text-white">{i + 1}</span>
            </span>
          ))}
          {rect && <span className="pointer-events-none absolute rounded border-2 border-dashed border-brand bg-brand/15" style={{ left: `${rect.x}%`, top: `${rect.y}%`, width: `${rect.w}%`, height: `${rect.h}%` }} />}
        </div>
      </div>
      <ul className="flex flex-wrap gap-2 text-sm">
        {regions.map((g, i) => (
          <li key={g.id} className="flex items-center gap-2 rounded-lg border border-line bg-white px-3 py-1.5">
            <b className="text-emerald-700">{e.area} {i + 1}</b>
            <span className="text-xs text-slate" dir="ltr">{g.x},{g.y} · {g.w}×{g.h}</span>
            <button type="button" onClick={() => onChange(regions.filter((x) => x.id !== g.id))} className="text-gold-600 hover:underline">{e.remove}</button>
          </li>
        ))}
        {!regions.length && <li className="text-slate">{labels.attempt.noAreas}</li>}
      </ul>
    </div>
  );
}

/** optional table / chart for any question type */
function FigureEditor({ e, labels, figure, locale, onChange }: { e: ExamLabels["bank"]["editor"]; labels: ExamLabels; figure: Figure | undefined; locale: string; onChange: (f: Figure | undefined) => void }) {
  const rows = figure?.rows ?? [];
  const setRows = (next: string[][]) => figure && onChange({ ...figure, rows: next });
  const cols = rows[0]?.length ?? 0;
  return (
    <details className="rounded-xl border border-line p-3" open={!!figure}>
      <summary className="cursor-pointer text-sm font-semibold text-navy">{e.figure}</summary>
      <div className="mt-3 space-y-3">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label={e.figureKind}>
            <select
              value={figure?.kind ?? ""}
              onChange={(ev) => {
                const k = ev.target.value as FigureKind | "";
                onChange(k ? (figure ? { ...figure, kind: k } : { kind: k, captionAr: "", captionEn: "", rows: [["", ""], ["", ""], ["", ""]] }) : undefined);
              }}
              className="field"
            >
              <option value="">{e.figureKinds.NONE}</option>
              {FIGURE_KINDS.map((k) => <option key={k} value={k}>{e.figureKinds[k]}</option>)}
            </select>
          </Field>
          {figure && (
            <>
              <Field label={e.captionAr}><input value={figure.captionAr} onChange={(ev) => onChange({ ...figure, captionAr: ev.target.value })} className="field" dir="rtl" /></Field>
              <Field label={e.captionEn}><input value={figure.captionEn} onChange={(ev) => onChange({ ...figure, captionEn: ev.target.value })} className="field" dir="ltr" /></Field>
            </>
          )}
        </div>
        {figure && (
          <>
            <p className="text-xs text-slate">{e.figureHint}</p>
            <div className="overflow-x-auto">
              <table className="border-collapse">
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i}>
                      {r.map((c, k) => (
                        <td key={k} className="p-0.5">
                          <input value={c} onChange={(ev) => setRows(rows.map((x, a) => (a === i ? x.map((y, b) => (b === k ? ev.target.value : y)) : x)))} className={`field w-28 py-1.5 text-sm ${i === 0 ? "font-semibold" : ""}`} aria-label={`${i + 1}:${k + 1}`} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={rows.length >= 31} onClick={() => setRows([...rows, Array(cols).fill("")])} className="btn btn-outline btn-sm">{e.addRow}</button>
              <button type="button" disabled={rows.length <= 2} onClick={() => setRows(rows.slice(0, -1))} className="btn btn-outline btn-sm">{e.delRow}</button>
              <button type="button" disabled={cols >= 10} onClick={() => setRows(rows.map((r) => [...r, ""]))} className="btn btn-outline btn-sm">{e.addCol}</button>
              <button type="button" disabled={cols <= 2} onClick={() => setRows(rows.map((r) => r.slice(0, -1)))} className="btn btn-outline btn-sm">{e.delCol}</button>
            </div>
            <FigureView figure={figure} locale={locale} labels={labels} />
          </>
        )}
      </div>
    </details>
  );
}

/** Create / edit one question. Inputs adapt to the type; the database validates everything again on save. */
export function QuestionEditor({
  programId,
  initial,
  categories,
  scenarios = [],
  locale,
  labels,
  onSaved,
  onCancel,
}: {
  programId: string;
  initial: QuestionFull | null;
  categories: Category[];
  scenarios?: ScenarioSummary[];
  locale: string;
  labels: ExamLabels;
  onSaved: (q: QuestionFull) => void;
  onCancel: () => void;
}) {
  const b = labels.bank;
  const e = b.editor;
  const [q, setQ] = useState<QuestionFull>(initial ?? blankQuestion("MCQ"));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState(false);
  const isNew = !q.id;
  const set = (patch: Partial<QuestionFull>) => setQ((cur) => ({ ...cur, ...patch }));
  const setContent = (patch: Partial<QuestionFull["content"]>) => setQ((cur) => ({ ...cur, content: { ...cur.content, ...patch } }));
  const setAnswer = (patch: Partial<QuestionFull["answer"]>) => setQ((cur) => ({ ...cur, answer: { ...cur.answer, ...patch } }));

  // phase 10: the hotspot picture is the first image attachment
  const [assets, setAssets] = useState<ExamAsset[]>([]);
  const hotspotUrl = useSignedOne(q.type === "HOTSPOT" ? assets.find((a) => a.kind === "IMAGE")?.path : null);
  const arText = useRef<HTMLTextAreaElement>(null);
  const enText = useRef<HTMLTextAreaElement>(null);
  const blanks = q.content.blanks ?? [];
  const insertAt = (el: HTMLTextAreaElement | null, value: string, marker: string) => {
    const s = el?.selectionStart ?? value.length;
    const t = el?.selectionEnd ?? s;
    return value.slice(0, s) + marker + value.slice(t);
  };
  const addBlank = () => {
    const id = String(Math.max(0, ...blanks.map((b) => Number(b.id) || 0)) + 1);
    setContent({ blanks: [...blanks, { id, kind: "SELECT", options: twoItems() }], textAr: insertAt(arText.current, q.content.textAr ?? "", `[[${id}]]`) });
  };
  const setBlank = (id: string, patch: Partial<ClozeBlank>) => setContent({ blanks: blanks.map((b) => (b.id === id ? { ...b, ...patch } : b)) });
  const setBlankAnswer = (id: string, v: { correct?: string; accepted?: string[]; caseSensitive?: boolean }) => setAnswer({ blanks: { ...(q.answer.blanks ?? {}), [id]: v } });
  const removeBlank = (id: string) => {
    const strip = (s?: string) => (s ?? "").split(`[[${id}]]`).join("");
    const rest = { ...(q.answer.blanks ?? {}) };
    delete rest[id];
    setContent({ blanks: blanks.filter((b) => b.id !== id), textAr: strip(q.content.textAr), textEn: strip(q.content.textEn) });
    setAnswer({ blanks: rest });
  };

  const changeType = (type: QuestionType) => {
    const fresh = blankQuestion(type);
    fresh.content = { ...fresh.content, figure: q.content.figure };
    setQ((cur) => ({ ...fresh, stemAr: cur.stemAr, stemEn: cur.stemEn, status: cur.status, difficulty: cur.difficulty, points: cur.points, weight: cur.weight, domainId: cur.domainId, topicId: cur.topicId, subtopicId: cur.subtopicId, keywords: cur.keywords, reference: cur.reference, feedbackAr: cur.feedbackAr, feedbackEn: cur.feedbackEn, explanationAr: cur.explanationAr, explanationEn: cur.explanationEn, scenarioId: cur.scenarioId }));
  };

  const domains = categories.filter((c) => c.kind === "DOMAIN");
  const topics = categories.filter((c) => c.kind === "TOPIC" && (!q.domainId || c.parentId === q.domainId));
  const subtopics = categories.filter((c) => c.kind === "SUBTOPIC" && (!q.topicId || c.parentId === q.topicId));

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const saved = await rpc<QuestionFull>("exam_bank_question_save", { p_program: programId, p_q: toSavePayload(q) });
      onSaved(saved);
    } catch (err) {
      const key = bankErrorKey(err);
      setError((b.errors as Record<string, string>)[key] ?? labels.errorGeneric);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-2xl font-bold">{isNew ? e.titleNew : `${e.titleEdit} · ${b.version}${q.version}`}</h2>
        <div className="flex gap-2">
          <button type="button" onClick={() => setPreview(!preview)} className="btn btn-outline btn-sm" aria-pressed={preview}>
            {b.preview}
          </button>
          <button type="button" onClick={onCancel} className="btn btn-outline btn-sm">
            {e.cancel}
          </button>
        </div>
      </div>

      {preview && (
        <div className="rounded-2xl bg-mist p-4">
          <p className="mb-3 text-sm font-semibold text-slate">{e.previewTitle}</p>
          <QuestionPreview key={JSON.stringify(q.content)} q={q} locale={locale} labels={labels} />
        </div>
      )}

      <div className="card space-y-5 p-5 sm:p-6">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label={e.type}>
            <select value={q.type} onChange={(ev) => changeType(ev.target.value as QuestionType)} className="field" disabled={!isNew}>
              {QUESTION_TYPES.map((t) => (
                <option key={t} value={t}>
                  {b.types[t]}
                </option>
              ))}
            </select>
          </Field>
          <Field label={e.status}>
            <select value={q.status} onChange={(ev) => set({ status: ev.target.value as QuestionFull["status"] })} className="field">
              {(["DRAFT", "ACTIVE", "DISABLED"] as const).map((s) => (
                <option key={s} value={s}>
                  {b.statuses[s]}
                </option>
              ))}
            </select>
          </Field>
          <Field label={e.difficulty}>
            <select value={q.difficulty} onChange={(ev) => set({ difficulty: ev.target.value as QuestionFull["difficulty"] })} className="field">
              {(["EASY", "MEDIUM", "HARD"] as const).map((d) => (
                <option key={d} value={d}>
                  {b.difficulties[d]}
                </option>
              ))}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={e.points}>
              <input type="number" min={0.01} step={0.01} value={q.points} onChange={(ev) => set({ points: Number(ev.target.value) })} className="field" dir="ltr" />
            </Field>
            <Field label={e.weight}>
              <input type="number" min={0.01} step={0.01} value={q.weight} onChange={(ev) => set({ weight: Number(ev.target.value) })} className="field" dir="ltr" />
            </Field>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label={e.domain}>
            <select value={q.domainId ?? ""} onChange={(ev) => set({ domainId: ev.target.value || null, topicId: null, subtopicId: null })} className="field">
              <option value="">{e.none}</option>
              {domains.map((c) => (
                <option key={c.id} value={c.id}>
                  {catName(c, locale)}
                </option>
              ))}
            </select>
          </Field>
          <Field label={e.topic}>
            <select value={q.topicId ?? ""} onChange={(ev) => { const t = categories.find((c) => c.id === ev.target.value); set({ topicId: t?.id ?? null, domainId: t?.parentId ?? q.domainId, subtopicId: null }); }} className="field">
              <option value="">{e.none}</option>
              {topics.map((c) => (
                <option key={c.id} value={c.id}>
                  {catName(c, locale)}
                </option>
              ))}
            </select>
          </Field>
          <Field label={e.subtopic}>
            <select value={q.subtopicId ?? ""} onChange={(ev) => { const s = categories.find((c) => c.id === ev.target.value); const t = categories.find((c) => c.id === s?.parentId); set({ subtopicId: s?.id ?? null, topicId: t?.id ?? q.topicId, domainId: t?.parentId ?? q.domainId }); }} className="field">
              <option value="">{e.none}</option>
              {subtopics.map((c) => (
                <option key={c.id} value={c.id}>
                  {catName(c, locale)}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <Field label={e.scenario} className="max-w-xl">
          <select value={q.scenarioId ?? ""} onChange={(ev) => set({ scenarioId: ev.target.value || null })} className="field">
            <option value="">{e.noScenario}</option>
            {scenarios.map((sc) => (
              <option key={sc.id} value={sc.id}>
                {scenarioTitle(sc, locale)}
              </option>
            ))}
          </select>
        </Field>

        <Field label={e.stemAr}>
          <textarea value={q.stemAr} onChange={(ev) => set({ stemAr: ev.target.value })} rows={3} className="field" dir="rtl" />
        </Field>
        <Field label={e.stemEn}>
          <textarea value={q.stemEn} onChange={(ev) => set({ stemEn: ev.target.value })} rows={2} className="field" dir="ltr" />
        </Field>

        {/* ── type-specific ── */}
        {(q.type === "MCQ" || q.type === "MULTI") && (
          <div className="space-y-3">
            <p className="field-label">
              {e.options} <span className="font-normal text-slate">— {q.type === "MCQ" ? e.correctHint : e.correctHintMulti}</span>
            </p>
            <ItemRows
              e={e}
              list={q.content.options ?? []}
              onChange={(options) => { setContent({ options }); setAnswer({ correct: (q.answer.correct ?? []).filter((id) => options.some((o) => o.id === id)) }); }}
              lead={(it) => (
                <label className="flex items-center gap-1.5 px-1 text-xs font-semibold text-emerald-700">
                  <input
                    type={q.type === "MCQ" ? "radio" : "checkbox"}
                    name="correct"
                    checked={(q.answer.correct ?? []).includes(it.id)}
                    onChange={(ev) => setAnswer({ correct: q.type === "MCQ" ? [it.id] : ev.target.checked ? [...(q.answer.correct ?? []), it.id] : (q.answer.correct ?? []).filter((x) => x !== it.id) })}
                    className="h-4 w-4 accent-emerald-600"
                  />
                  {e.correct}
                </label>
              )}
            />
            {q.type === "MULTI" && <ScoringSelect e={e} mode={(q.scoring.mode as ScoringMode) ?? "ALL_OR_NOTHING"} modes={["ALL_OR_NOTHING", "PARTIAL", "PARTIAL_PENALTY"]} onChange={(mode) => set({ scoring: { mode } })} />}
            <details className="rounded-xl border border-line p-3">
              <summary className="cursor-pointer text-sm font-semibold text-navy">{e.rationale}</summary>
              <div className="mt-3 space-y-2">
                {(q.content.options ?? []).map((o, i) => (
                  <div key={o.id} className="grid gap-2 sm:grid-cols-[2rem_1fr_1fr] sm:items-center">
                    <span className="text-sm font-bold text-slate">{i + 1}</span>
                    <input value={q.optionRationale[o.id]?.ar ?? ""} onChange={(ev) => set({ optionRationale: { ...q.optionRationale, [o.id]: { ...q.optionRationale[o.id], ar: ev.target.value } } })} className="field py-2" dir="rtl" placeholder={o.textAr || o.textEn} />
                    <input value={q.optionRationale[o.id]?.en ?? ""} onChange={(ev) => set({ optionRationale: { ...q.optionRationale, [o.id]: { ...q.optionRationale[o.id], en: ev.target.value } } })} className="field py-2" dir="ltr" placeholder="English" />
                  </div>
                ))}
              </div>
            </details>
          </div>
        )}

        {q.type === "TRUE_FALSE" && (
          <fieldset>
            <legend className="field-label">{e.tfAnswer}</legend>
            <div className="flex gap-3">
              {[
                [true, e.tfTrue],
                [false, e.tfFalse],
              ].map(([v, l]) => (
                <label key={String(v)} className={`flex cursor-pointer items-center gap-2 rounded-xl border px-5 py-3 ${q.answer.value === v ? "border-emerald-500 bg-emerald-50" : "border-line"}`}>
                  <input type="radio" name="tf" checked={q.answer.value === v} onChange={() => setAnswer({ value: v as boolean })} className="h-4 w-4 accent-emerald-600" />
                  {l as string}
                </label>
              ))}
            </div>
          </fieldset>
        )}

        {q.type === "NUMERIC" && (
          <div className="grid gap-4 sm:grid-cols-4">
            <Field label={e.numValue}>
              <input type="number" step="any" value={typeof q.answer.value === "number" ? q.answer.value : ""} onChange={(ev) => setAnswer({ value: ev.target.value === "" ? undefined : Number(ev.target.value) })} className="field" dir="ltr" />
            </Field>
            <Field label={e.numTolerance}>
              <input type="number" step="any" min={0} value={q.answer.tolerance ?? 0} onChange={(ev) => setAnswer({ tolerance: Number(ev.target.value) })} className="field" dir="ltr" />
            </Field>
            <Field label={e.unitAr}>
              <input value={q.content.unitAr ?? ""} onChange={(ev) => setContent({ unitAr: ev.target.value })} className="field" dir="rtl" />
            </Field>
            <Field label={e.unitEn}>
              <input value={q.content.unitEn ?? ""} onChange={(ev) => setContent({ unitEn: ev.target.value })} className="field" dir="ltr" />
            </Field>
          </div>
        )}

        {q.type === "SHORT" && (
          <div className="space-y-3">
            <Field label={e.accepted}>
              <textarea value={(q.answer.accepted ?? []).join("\n")} onChange={(ev) => setAnswer({ accepted: ev.target.value.split("\n") })} rows={4} className="field" />
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={!!q.answer.caseSensitive} onChange={(ev) => setAnswer({ caseSensitive: ev.target.checked })} className="h-4 w-4 accent-[var(--color-brand)]" />
              {e.caseSensitive}
            </label>
          </div>
        )}

        {q.type === "ESSAY" && (
          <div className="space-y-4">
            <div className="grid max-w-md grid-cols-2 gap-3">
              <Field label={e.minWords}>
                <input type="number" min={0} value={q.content.minWords ?? ""} onChange={(ev) => setContent({ minWords: ev.target.value === "" ? undefined : Number(ev.target.value) })} className="field" dir="ltr" />
              </Field>
              <Field label={e.maxWords}>
                <input type="number" min={1} value={q.content.maxWords ?? ""} onChange={(ev) => setContent({ maxWords: ev.target.value === "" ? undefined : Number(ev.target.value) })} className="field" dir="ltr" />
              </Field>
            </div>
            <Field label={e.rubricAr}>
              <textarea value={q.answer.rubricAr ?? ""} onChange={(ev) => setAnswer({ rubricAr: ev.target.value })} rows={3} className="field" dir="rtl" />
            </Field>
            <Field label={e.rubricEn}>
              <textarea value={q.answer.rubricEn ?? ""} onChange={(ev) => setAnswer({ rubricEn: ev.target.value })} rows={2} className="field" dir="ltr" />
            </Field>
          </div>
        )}

        {q.type === "ORDERING" && (
          <div className="space-y-3">
            <p className="field-label">
              {e.items} <span className="font-normal text-slate">— {e.itemsHint}</span>
            </p>
            <ItemRows e={e} list={q.content.items ?? []} onChange={(items) => setContent({ items })} reorder lead={(_, i) => <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-mist text-sm font-bold text-navy">{i + 1}</span>} />
            <ScoringSelect e={e} mode={(q.scoring.mode as ScoringMode) ?? "ALL_OR_NOTHING"} modes={["ALL_OR_NOTHING", "PARTIAL"]} onChange={(mode) => set({ scoring: { mode } })} />
          </div>
        )}

        {q.type === "MATCHING" && (
          <div className="space-y-4">
            <div>
              <p className="field-label">{e.right} <span className="font-normal text-slate">— {e.rightHint}</span></p>
              <ItemRows
              e={e}
                list={q.content.right ?? []}
                min={Math.max(2, (q.content.left ?? []).length)}
                onChange={(right) => { setContent({ right }); setAnswer({ pairs: Object.fromEntries(Object.entries(q.answer.pairs ?? {}).filter(([, r]) => right.some((x) => x.id === r))) }); }}
              />
            </div>
            <div>
              <p className="field-label">{e.left}</p>
              <ItemRows
              e={e}
                list={q.content.left ?? []}
                onChange={(left) => { setContent({ left }); setAnswer({ pairs: Object.fromEntries(Object.entries(q.answer.pairs ?? {}).filter(([l]) => left.some((x) => x.id === l))) }); }}
                lead={(it) => (
                  <select value={q.answer.pairs?.[it.id] ?? ""} onChange={(ev) => setAnswer({ pairs: { ...(q.answer.pairs ?? {}), [it.id]: ev.target.value } })} className="field w-auto max-w-[12rem] py-2 text-sm" aria-label={e.matchFor}>
                    <option value="">{e.matchFor}…</option>
                    {(q.content.right ?? []).map((r, i) => (
                      <option key={r.id} value={r.id}>
                        {i + 1}. {(locale === "ar" ? r.textAr || r.textEn : r.textEn || r.textAr) || "…"}
                      </option>
                    ))}
                  </select>
                )}
              />
            </div>
            <ScoringSelect e={e} mode={(q.scoring.mode as ScoringMode) ?? "ALL_OR_NOTHING"} modes={["ALL_OR_NOTHING", "PARTIAL"]} onChange={(mode) => set({ scoring: { mode } })} />
          </div>
        )}

        {/* ── phase 10 ── */}
        {q.type === "HOTSPOT" && (
          <div className="space-y-3">
            <p className="field-label">{e.areas} <span className="font-normal text-slate">— {e.hotspotHint}</span></p>
            {q.id ? <HotspotEditor e={e} labels={labels} url={hotspotUrl} regions={q.answer.regions ?? []} onChange={(regions) => setAnswer({ regions })} /> : <Notice>{e.hotspotSaveFirst}</Notice>}
            <ScoringSelect e={e} mode={(q.scoring.mode as ScoringMode) ?? "ALL_OR_NOTHING"} modes={["ALL_OR_NOTHING", "PARTIAL", "PARTIAL_PENALTY"]} onChange={(mode) => set({ scoring: { mode } })} />
          </div>
        )}

        {q.type === "DRAGDROP" && (
          <div className="space-y-4">
            <div>
              <p className="field-label">{e.zones}</p>
              <ItemRows
                e={e}
                list={q.content.zones ?? []}
                min={1}
                onChange={(zones) => { setContent({ zones }); setAnswer({ placements: Object.fromEntries(Object.entries(q.answer.placements ?? {}).filter(([, z]) => zones.some((x) => x.id === z))) }); }}
              />
            </div>
            <div>
              <p className="field-label">{e.ddItems} <span className="font-normal text-slate">— {e.ddItemsHint}</span></p>
              <ItemRows
                e={e}
                list={q.content.items ?? []}
                onChange={(items) => { setContent({ items }); setAnswer({ placements: Object.fromEntries(Object.entries(q.answer.placements ?? {}).filter(([i]) => items.some((x) => x.id === i))) }); }}
                lead={(it) => (
                  <select
                    value={q.answer.placements?.[it.id] ?? ""}
                    onChange={(ev) => {
                      const p = { ...(q.answer.placements ?? {}) };
                      if (ev.target.value) p[it.id] = ev.target.value;
                      else delete p[it.id];
                      setAnswer({ placements: p });
                    }}
                    className="field w-auto max-w-[12rem] py-2 text-sm"
                    aria-label={e.zone}
                  >
                    <option value="">{e.distractor}</option>
                    {(q.content.zones ?? []).map((z, i) => (
                      <option key={z.id} value={z.id}>
                        {i + 1}. {(locale === "ar" ? z.textAr || z.textEn : z.textEn || z.textAr) || "…"}
                      </option>
                    ))}
                  </select>
                )}
              />
            </div>
            <ScoringSelect e={e} mode={(q.scoring.mode as ScoringMode) ?? "ALL_OR_NOTHING"} modes={["ALL_OR_NOTHING", "PARTIAL", "PARTIAL_PENALTY"]} onChange={(mode) => set({ scoring: { mode } })} />
          </div>
        )}

        {q.type === "CLOZE" && (
          <div className="space-y-4">
            <p className="text-sm text-slate">{e.clozeHint}</p>
            <Field label={e.clozeTextAr}>
              <textarea ref={arText} value={q.content.textAr ?? ""} onChange={(ev) => setContent({ textAr: ev.target.value })} rows={5} className="field" dir="rtl" />
            </Field>
            <button type="button" onClick={addBlank} disabled={blanks.length >= 20} className="btn btn-outline btn-sm">+ {e.insertBlank}</button>
            <Field label={e.clozeTextEn}>
              <textarea ref={enText} value={q.content.textEn ?? ""} onChange={(ev) => setContent({ textEn: ev.target.value })} rows={4} className="field" dir="ltr" />
            </Field>
            {blanks.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="text-slate">{e.insertInEnglish}</span>
                {blanks.map((b) => (
                  <button key={b.id} type="button" onClick={() => setContent({ textEn: insertAt(enText.current, q.content.textEn ?? "", `[[${b.id}]]`) })} className="rounded-lg border border-line px-2 py-1 font-mono text-xs hover:border-brand" dir="ltr">
                    [[{b.id}]]
                  </button>
                ))}
              </div>
            )}
            {blanks.map((b) => {
              const ans = q.answer.blanks?.[b.id] ?? {};
              return (
                <div key={b.id} className="space-y-3 rounded-xl border border-line bg-mist/40 p-3">
                  <div className="flex flex-wrap items-center gap-3">
                    <b className="text-navy" dir="ltr">[[{b.id}]]</b>
                    <select
                      value={b.kind}
                      onChange={(ev) => {
                        const kind = ev.target.value as ClozeBlank["kind"];
                        setBlank(b.id, { kind, options: kind === "SELECT" ? b.options ?? twoItems() : undefined });
                        setBlankAnswer(b.id, kind === "SELECT" ? {} : { accepted: [] });
                      }}
                      className="field w-auto py-1.5 text-sm"
                      aria-label={e.blankKind}
                    >
                      <option value="SELECT">{e.blankKinds.SELECT}</option>
                      <option value="TEXT">{e.blankKinds.TEXT}</option>
                    </select>
                    <button type="button" onClick={() => removeBlank(b.id)} className="text-sm text-gold-600 hover:underline">{e.remove}</button>
                  </div>
                  {b.kind === "SELECT" ? (
                    <ItemRows
                      e={e}
                      list={b.options ?? []}
                      onChange={(options) => { setBlank(b.id, { options }); if (ans.correct && !options.some((o) => o.id === ans.correct)) setBlankAnswer(b.id, {}); }}
                      lead={(it) => (
                        <label className="flex items-center gap-1.5 px-1 text-xs font-semibold text-emerald-700">
                          <input type="radio" name={`blank-${b.id}`} checked={ans.correct === it.id} onChange={() => setBlankAnswer(b.id, { correct: it.id })} className="h-4 w-4 accent-emerald-600" />
                          {e.correct}
                        </label>
                      )}
                    />
                  ) : (
                    <div className="space-y-2">
                      <Field label={e.accepted}>
                        <textarea value={(ans.accepted ?? []).join("\n")} onChange={(ev) => setBlankAnswer(b.id, { ...ans, accepted: ev.target.value.split("\n") })} rows={3} className="field" />
                      </Field>
                      <label className="flex items-center gap-2 text-sm">
                        <input type="checkbox" checked={!!ans.caseSensitive} onChange={(ev) => setBlankAnswer(b.id, { ...ans, caseSensitive: ev.target.checked })} className="h-4 w-4 accent-[var(--color-brand)]" />
                        {e.caseSensitive}
                      </label>
                    </div>
                  )}
                </div>
              );
            })}
            <ScoringSelect e={e} mode={(q.scoring.mode as ScoringMode) ?? "ALL_OR_NOTHING"} modes={["ALL_OR_NOTHING", "PARTIAL"]} onChange={(mode) => set({ scoring: { mode } })} />
          </div>
        )}

        {/* graphic-based: table / chart on any type */}
        <FigureEditor e={e} labels={labels} figure={q.content.figure} locale={locale} onChange={(figure) => setContent({ figure })} />

        {/* ── learning support (never sent during a test) ── */}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={e.feedbackAr}>
            <textarea value={q.feedbackAr} onChange={(ev) => set({ feedbackAr: ev.target.value })} rows={3} className="field" dir="rtl" />
          </Field>
          <Field label={e.feedbackEn}>
            <textarea value={q.feedbackEn} onChange={(ev) => set({ feedbackEn: ev.target.value })} rows={3} className="field" dir="ltr" />
          </Field>
          <Field label={e.explanationAr}>
            <textarea value={q.explanationAr} onChange={(ev) => set({ explanationAr: ev.target.value })} rows={4} className="field" dir="rtl" />
          </Field>
          <Field label={e.explanationEn}>
            <textarea value={q.explanationEn} onChange={(ev) => set({ explanationEn: ev.target.value })} rows={4} className="field" dir="ltr" />
          </Field>
          <Field label={e.reference}>
            <input value={q.reference} onChange={(ev) => set({ reference: ev.target.value })} className="field" />
          </Field>
          <Field label={e.keywords}>
            <input value={q.keywords.join(", ")} onChange={(ev) => set({ keywords: ev.target.value.split(/[,،]/).map((k) => k.trim()) })} className="field" />
          </Field>
        </div>
        <p className="flex items-center gap-2 rounded-xl bg-mist px-4 py-3 text-sm text-slate">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-4 w-4 shrink-0" aria-hidden="true"><rect x="4" y="10" width="16" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></svg>
          {e.hiddenNote}
        </p>

        <div className="rounded-xl border border-line p-4">
          {q.id ? (
            <AssetManager programId={programId} ownerType="QUESTION" ownerId={q.id} canEdit labels={labels} onChange={setAssets} />
          ) : (
            <p className="text-sm text-slate">{labels.bank.assets.saveFirst}</p>
          )}
        </div>

        {error && <Notice tone="error">{error}</Notice>}
        <div className="flex flex-wrap gap-3">
          <button type="button" onClick={save} disabled={busy} className="btn btn-primary">
            {busy ? labels.loading : e.save}
          </button>
          <button type="button" onClick={onCancel} className="btn btn-outline">
            {e.cancel}
          </button>
        </div>
      </div>
    </div>
  );
}
