"use client";

import { useState, type ReactNode } from "react";
import { rpc } from "@/lib/exams/client";
import {
  bankErrorKey,
  blankQuestion,
  catName,
  newItemId,
  QUESTION_TYPES,
  toSavePayload,
  type Category,
  type Item,
  type QuestionFull,
  type QuestionType,
  type ScoringMode,
} from "@/lib/exams/bank";
import { Notice, type ExamLabels } from "./ExamShell";
import { QuestionPreview } from "./QuestionPreview";

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

/** Create / edit one question. Inputs adapt to the type; the database validates everything again on save. */
export function QuestionEditor({
  programId,
  initial,
  categories,
  locale,
  labels,
  onSaved,
  onCancel,
}: {
  programId: string;
  initial: QuestionFull | null;
  categories: Category[];
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

  const changeType = (type: QuestionType) => {
    const fresh = blankQuestion(type);
    setQ((cur) => ({ ...fresh, stemAr: cur.stemAr, stemEn: cur.stemEn, status: cur.status, difficulty: cur.difficulty, points: cur.points, weight: cur.weight, domainId: cur.domainId, topicId: cur.topicId, subtopicId: cur.subtopicId, keywords: cur.keywords, reference: cur.reference, feedbackAr: cur.feedbackAr, feedbackEn: cur.feedbackEn, explanationAr: cur.explanationAr, explanationEn: cur.explanationEn }));
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
