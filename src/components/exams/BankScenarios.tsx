"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { rpc } from "@/lib/exams/client";
import {
  bankErrorKey,
  blankScenario,
  pick,
  SCENARIO_PARTS,
  stem,
  title,
  type ExamAsset,
  type ScenarioFull,
  type ScenarioSummary,
  type ScenarioTable,
} from "@/lib/exams/bank";
import { cn } from "@/lib/utils";
import { Notice, Spinner, type ExamLabels } from "./ExamShell";
import { AssetManager, removeFiles, signedUrls } from "./AssetManager";

/** The case itself, as learners will see it next to (or above) its questions */
export function ScenarioView({ s, locale, labels, images = [] }: { s: ScenarioFull; locale: string; labels: ExamLabels; images?: { url: string; caption: string }[] }) {
  const sc = labels.bank.scenarios;
  const ar = locale === "ar";
  const body = ar ? s.bodyAr || s.bodyEn : s.bodyEn || s.bodyAr;
  return (
    <article className="space-y-4 text-[15px] leading-7">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-brand">{sc.caseLabel}</p>
        <h3 className="mt-1 text-lg font-bold text-navy">{title(s, locale)}</h3>
      </div>
      {body && <p className="whitespace-pre-line text-ink">{body}</p>}
      {SCENARIO_PARTS.filter((k) => pick(s.details[k], locale)).map((k) => (
        <div key={k}>
          <p className="font-semibold text-navy">{sc.parts[k]}</p>
          <p className="whitespace-pre-line text-ink">{pick(s.details[k], locale)}</p>
        </div>
      ))}
      {s.tables.map((t, i) => (
        <figure key={i} className="overflow-x-auto">
          {(ar ? t.captionAr || t.captionEn : t.captionEn || t.captionAr) && <figcaption className="mb-1 text-sm font-semibold text-navy">{ar ? t.captionAr || t.captionEn : t.captionEn || t.captionAr}</figcaption>}
          <table className="w-full border-collapse text-sm">
            <tbody>
              {t.rows.map((row, r) => (
                <tr key={r} className={r === 0 ? "bg-mist font-semibold text-navy" : ""}>
                  {row.map((cell, c) => (
                    <td key={c} className="border border-line px-3 py-1.5">{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </figure>
      ))}
      {images.map((im, i) => (
        <figure key={i}>
          {/* eslint-disable-next-line @next/next/no-img-element -- signed URL from private storage */}
          <img src={im.url} alt={im.caption} className="max-h-80 w-full rounded-lg bg-mist object-contain" draggable={false} />
          {im.caption && <figcaption className="mt-1 text-sm text-slate">{im.caption}</figcaption>}
        </figure>
      ))}
    </article>
  );
}

/** Load a scenario with signed image URLs (for previews) */
export async function loadScenarioForView(id: string, locale: string) {
  const s = await rpc<ScenarioFull>("exam_bank_scenario", { p_id: id });
  const assets = await rpc<ExamAsset[]>("exam_assets", { p_owner_type: "SCENARIO", p_owner_id: id });
  const imgs = assets.filter((a) => a.kind === "IMAGE");
  const urls = await signedUrls(imgs.map((a) => a.path));
  return { s, images: imgs.filter((a) => urls[a.path]).map((a) => ({ url: urls[a.path], caption: locale === "ar" ? a.captionAr || a.captionEn : a.captionEn || a.captionAr })) };
}

const Field = ({ label, children, className = "" }: { label: string; children: ReactNode; className?: string }) => (
  <label className={`block text-sm ${className}`}>
    <span className="field-label">{label}</span>
    {children}
  </label>
);

function TableEditor({ t, onChange, onRemove, labels }: { t: ScenarioTable; onChange: (t: ScenarioTable) => void; onRemove: () => void; labels: ExamLabels }) {
  const sc = labels.bank.scenarios;
  const cols = t.rows[0]?.length ?? 1;
  const setCell = (r: number, c: number, v: string) => onChange({ ...t, rows: t.rows.map((row, i) => (i === r ? row.map((x, j) => (j === c ? v : x)) : row)) });
  return (
    <div className="space-y-2 rounded-xl border border-line bg-white p-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <input value={t.captionAr} onChange={(e) => onChange({ ...t, captionAr: e.target.value })} placeholder={`${sc.caption} (AR)`} className="field py-2" dir="rtl" />
        <input value={t.captionEn} onChange={(e) => onChange({ ...t, captionEn: e.target.value })} placeholder={`${sc.caption} (EN)`} className="field py-2" dir="ltr" />
      </div>
      <div className="overflow-x-auto">
        <table className="border-collapse">
          <tbody>
            {t.rows.map((row, r) => (
              <tr key={r}>
                {row.map((cell, c) => (
                  <td key={c} className="p-0.5">
                    <input value={cell} onChange={(e) => setCell(r, c, e.target.value)} className={cn("field w-36 px-2 py-1.5 text-sm", r === 0 && "font-semibold")} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap gap-1.5 text-xs">
        <button type="button" disabled={t.rows.length >= 40} onClick={() => onChange({ ...t, rows: [...t.rows, Array(cols).fill("")] })} className="btn btn-outline btn-sm">{sc.addRow}</button>
        <button type="button" disabled={t.rows.length <= 1} onClick={() => onChange({ ...t, rows: t.rows.slice(0, -1) })} className="btn btn-outline btn-sm">{sc.delRow}</button>
        <button type="button" disabled={cols >= 12} onClick={() => onChange({ ...t, rows: t.rows.map((row) => [...row, ""]) })} className="btn btn-outline btn-sm">{sc.addCol}</button>
        <button type="button" disabled={cols <= 1} onClick={() => onChange({ ...t, rows: t.rows.map((row) => row.slice(0, -1)) })} className="btn btn-outline btn-sm">{sc.delCol}</button>
        <button type="button" onClick={onRemove} className="ms-auto rounded-lg px-2.5 py-1 text-gold-600 hover:bg-gold/10">{sc.removeTable}</button>
      </div>
    </div>
  );
}

/** Scenarios tab of the question bank */
export function BankScenarios({
  programId,
  canEdit,
  canEditQuestions,
  locale,
  labels,
  openId,
  onOpen,
  onEditQuestion,
  onNewQuestion,
  onChanged,
}: {
  programId: string;
  canEdit: boolean;
  canEditQuestions: boolean;
  locale: string;
  labels: ExamLabels;
  openId: string | null; // "" = new scenario, null = list
  onOpen: (id: string | null) => void;
  onEditQuestion: (questionId: string) => void;
  onNewQuestion: (scenarioId: string) => void;
  onChanged: () => void;
}) {
  const b = labels.bank;
  const sc = b.scenarios;
  const [list, setList] = useState<ScenarioSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setList(await rpc<ScenarioSummary[]>("exam_bank_scenarios", { p_program: programId, p_filter: {} }));
    } catch {
      setError(labels.errorGeneric);
    }
  }, [programId, labels.errorGeneric]);

  useEffect(() => {
    if (openId === null) load();
  }, [openId, load]);

  if (openId !== null)
    return (
      <ScenarioEditor
        key={openId || "new"}
        programId={programId}
        id={openId}
        canEdit={canEdit}
        canEditQuestions={canEditQuestions}
        locale={locale}
        labels={labels}
        onSaved={(id) => { onOpen(id); onChanged(); }}
        onClose={() => onOpen(null)}
        onDeleted={() => { onOpen(null); onChanged(); }}
        onEditQuestion={onEditQuestion}
        onNewQuestion={onNewQuestion}
      />
    );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-3xl text-sm text-slate">{sc.intro}</p>
        {canEdit && <button type="button" onClick={() => onOpen("")} className="btn btn-primary btn-sm">+ {sc.new}</button>}
      </div>
      {error && <Notice tone="error">{error}</Notice>}
      {!list ? <Spinner /> : list.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-line bg-mist/60 px-6 py-10 text-center text-slate">{sc.none}</p>
      ) : (
        <ul className="space-y-3">
          {list.map((s) => (
            <li key={s.id} className={cn("card flex flex-wrap items-center gap-3 p-4", s.status === "DISABLED" && "opacity-70")}>
              <div className="min-w-0 flex-1">
                <p className="font-bold text-navy">{title(s, locale)}</p>
                <p className="mt-0.5 text-xs text-slate">
                  {b.statuses[s.status]} · {s.questions} {sc.questions} · {s.assets} {sc.files} · {b.version}{s.version}
                </p>
              </div>
              <button type="button" onClick={() => onOpen(s.id)} className="btn btn-outline btn-sm">{sc.open}</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ScenarioEditor({
  programId,
  id,
  canEdit,
  canEditQuestions,
  locale,
  labels,
  onSaved,
  onClose,
  onDeleted,
  onEditQuestion,
  onNewQuestion,
}: {
  programId: string;
  id: string;
  canEdit: boolean;
  canEditQuestions: boolean;
  locale: string;
  labels: ExamLabels;
  onSaved: (id: string) => void;
  onClose: () => void;
  onDeleted: () => void;
  onEditQuestion: (questionId: string) => void;
  onNewQuestion: (scenarioId: string) => void;
}) {
  const b = labels.bank;
  const sc = b.scenarios;
  const [s, setS] = useState<ScenarioFull | null>(id ? null : blankScenario());
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [images, setImages] = useState<{ url: string; caption: string }[]>([]);
  const [preview, setPreview] = useState(false);

  useEffect(() => {
    if (!id) return;
    rpc<ScenarioFull>("exam_bank_scenario", { p_id: id }).then(setS).catch(() => setFlash({ tone: "error", text: labels.errorGeneric }));
  }, [id, labels.errorGeneric]);

  const err = (e: unknown) => setFlash({ tone: "error", text: (b.errors as Record<string, string>)[bankErrorKey(e)] ?? labels.errorGeneric });
  if (!s) return flash ? <Notice tone="error">{flash.text}</Notice> : <Spinner />;
  const set = (patch: Partial<ScenarioFull>) => setS({ ...s, ...patch });

  const save = async () => {
    setBusy(true);
    setFlash(null);
    try {
      const saved = await rpc<ScenarioFull>("exam_bank_scenario_save", {
        p_program: programId,
        p_s: { id: s.id || undefined, titleAr: s.titleAr, titleEn: s.titleEn, bodyAr: s.bodyAr, bodyEn: s.bodyEn, details: s.details, tables: s.tables, displayMode: s.displayMode, status: s.status },
      });
      setS(saved);
      setFlash({ tone: "success", text: b.saved });
      if (!s.id) onSaved(saved.id);
    } catch (e) {
      err(e);
    } finally {
      setBusy(false);
    }
  };

  const move = async (i: number, d: -1 | 1) => {
    const qs = [...(s.questions ?? [])];
    const j = i + d;
    if (j < 0 || j >= qs.length) return;
    [qs[i], qs[j]] = [qs[j], qs[i]];
    try {
      setS(await rpc<ScenarioFull>("exam_bank_scenario_reorder", { p_id: s.id, p_ids: qs.map((q) => q.id) }));
    } catch (e) {
      err(e);
    }
  };

  const del = async () => {
    if ((s.questions ?? []).length) return setFlash({ tone: "error", text: sc.deleteBlocked });
    if (!window.confirm(sc.confirmDelete)) return;
    try {
      const r = await rpc<{ paths: string[] }>("exam_bank_scenario_delete", { p_id: s.id });
      await removeFiles(r.paths ?? []);
      onDeleted();
    } catch (e) {
      err(e);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-2xl font-bold">{s.id ? `${sc.titleEdit} · ${b.version}${s.version}` : sc.titleNew}</h2>
        <div className="flex gap-2">
          {s.id && <button type="button" onClick={() => setPreview(!preview)} className="btn btn-outline btn-sm" aria-pressed={preview}>{b.preview}</button>}
          <button type="button" onClick={onClose} className="btn btn-outline btn-sm">{b.editor.cancel}</button>
        </div>
      </div>
      {flash && <Notice tone={flash.tone}>{flash.text}</Notice>}
      {preview && (
        <div className="rounded-2xl bg-mist p-4">
          <div className="rounded-2xl bg-white p-5"><ScenarioView s={s} locale={locale} labels={labels} images={images} /></div>
        </div>
      )}

      <fieldset disabled={!canEdit} className="card space-y-5 p-5 sm:p-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={sc.titleAr}><input value={s.titleAr} onChange={(e) => set({ titleAr: e.target.value })} className="field" dir="rtl" /></Field>
          <Field label={sc.titleEn}><input value={s.titleEn} onChange={(e) => set({ titleEn: e.target.value })} className="field" dir="ltr" /></Field>
          <Field label={b.editor.status}>
            <select value={s.status} onChange={(e) => set({ status: e.target.value as ScenarioFull["status"] })} className="field">
              {(["DRAFT", "ACTIVE", "DISABLED"] as const).map((x) => <option key={x} value={x}>{b.statuses[x]}</option>)}
            </select>
          </Field>
          <Field label={sc.displayMode}>
            <select value={s.displayMode} onChange={(e) => set({ displayMode: e.target.value as ScenarioFull["displayMode"] })} className="field">
              {(["SIDE", "SECTION"] as const).map((x) => <option key={x} value={x}>{sc.modes[x]}</option>)}
            </select>
          </Field>
        </div>
        <Field label={sc.bodyAr}><textarea value={s.bodyAr} onChange={(e) => set({ bodyAr: e.target.value })} rows={6} className="field" dir="rtl" /></Field>
        <Field label={sc.bodyEn}><textarea value={s.bodyEn} onChange={(e) => set({ bodyEn: e.target.value })} rows={4} className="field" dir="ltr" /></Field>

        <details className="rounded-xl border border-line p-3" open={SCENARIO_PARTS.some((k) => s.details[k])}>
          <summary className="cursor-pointer text-sm font-semibold text-navy">{sc.details}</summary>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {SCENARIO_PARTS.map((k) => (
              <div key={k} className="space-y-1.5">
                <p className="field-label mb-0">{sc.parts[k]}</p>
                <textarea value={s.details[k]?.ar ?? ""} onChange={(e) => set({ details: { ...s.details, [k]: { ar: e.target.value, en: s.details[k]?.en ?? "" } } })} rows={2} className="field py-2 text-sm" dir="rtl" />
                <textarea value={s.details[k]?.en ?? ""} onChange={(e) => set({ details: { ...s.details, [k]: { ar: s.details[k]?.ar ?? "", en: e.target.value } } })} rows={2} className="field py-2 text-sm" dir="ltr" placeholder="English" />
              </div>
            ))}
          </div>
        </details>

        <div className="space-y-2">
          <p className="field-label">{sc.tables}</p>
          {s.tables.map((t, i) => (
            <TableEditor key={i} t={t} labels={labels} onChange={(nt) => set({ tables: s.tables.map((x, j) => (j === i ? nt : x)) })} onRemove={() => set({ tables: s.tables.filter((_, j) => j !== i) })} />
          ))}
          {s.tables.length < 10 && (
            <button type="button" onClick={() => set({ tables: [...s.tables, { captionAr: "", captionEn: "", rows: [["", ""], ["", ""]] }] })} className="btn btn-outline btn-sm">+ {sc.addTable}</button>
          )}
        </div>

        {canEdit && (
          <div className="flex flex-wrap gap-3">
            <button type="button" onClick={save} disabled={busy} className="btn btn-primary">{busy ? labels.loading : sc.save}</button>
            {s.id && <button type="button" onClick={del} className="btn btn-outline">{b.delete}</button>}
          </div>
        )}
      </fieldset>

      {!s.id ? (
        <Notice>{sc.saveFirst}</Notice>
      ) : (
        <>
          <div className="card p-5 sm:p-6">
            <AssetManager
              programId={programId}
              ownerType="SCENARIO"
              ownerId={s.id}
              canEdit={canEdit}
              labels={labels}
              onChange={async (assets: ExamAsset[]) => {
                const imgs = assets.filter((a) => a.kind === "IMAGE");
                const urls = await signedUrls(imgs.map((a) => a.path));
                setImages(imgs.filter((a) => urls[a.path]).map((a) => ({ url: urls[a.path], caption: locale === "ar" ? a.captionAr || a.captionEn : a.captionEn || a.captionAr })));
              }}
            />
          </div>

          <div className="card p-5 sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className="text-lg font-bold">
                {sc.linked} <span className="text-slate">({s.questions?.length ?? 0})</span>
              </h3>
              {canEditQuestions && <button type="button" onClick={() => onNewQuestion(s.id)} className="btn btn-primary btn-sm">+ {sc.addQuestion}</button>}
            </div>
            {(s.questions ?? []).length === 0 ? (
              <p className="mt-3 text-sm text-slate">{sc.noLinked}</p>
            ) : (
              <ol className="mt-3 space-y-2">
                {(s.questions ?? []).map((q, i) => (
                  <li key={q.id} className="flex items-center gap-3 rounded-xl border border-line px-3 py-2.5">
                    <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-navy text-sm font-bold text-white">{i + 1}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-navy">{stem(q, locale)}</span>
                      <span className="text-xs text-slate">{b.types[q.type]} · {b.statuses[q.status]} · {Number(q.points)} pt</span>
                    </span>
                    {canEdit && (
                      <span className="flex">
                        <button type="button" disabled={i === 0} onClick={() => move(i, -1)} className="rounded-lg px-2 py-1 text-slate hover:bg-mist disabled:opacity-30" aria-label={b.editor.up}>↑</button>
                        <button type="button" disabled={i === (s.questions ?? []).length - 1} onClick={() => move(i, 1)} className="rounded-lg px-2 py-1 text-slate hover:bg-mist disabled:opacity-30" aria-label={b.editor.down}>↓</button>
                      </span>
                    )}
                    {canEditQuestions && <button type="button" onClick={() => onEditQuestion(q.id)} className="rounded-lg px-2.5 py-1 text-sm font-semibold text-brand hover:bg-brand/10">{b.edit}</button>}
                  </li>
                ))}
              </ol>
            )}
          </div>
        </>
      )}
    </div>
  );
}
