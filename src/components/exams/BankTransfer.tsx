"use client";

/**
 * Phase 11 — import / export screen of a course's question bank.
 *   Import: file → read in the browser → server dry run (preview: valid / reason / duplicate / category) →
 *           choose questions → import (each one on its own) → upload embedded images → report.
 *   Export: whole bank / one category / a selected set → Moodle XML, JSON, GIFT, Aiken or CSV (+ images).
 * The server re-validates everything and logs every import and export.
 */
import { useMemo, useState } from "react";
import { supabase } from "@/lib/static/supabase";
import { rpc } from "@/lib/exams/client";
import { ASSET_BUCKET, ASSET_MAX, ASSET_TYPES, blankQuestion, catName, type Category, type QuestionFull } from "@/lib/exams/bank";
import {
  base64ToBytes,
  bytesToBase64,
  detectFormat,
  EXPORT_FORMATS,
  exportAs,
  FORMAT_TYPES,
  IMPORT_FORMATS,
  MAX_IMPORT_BYTES,
  parseFile,
  TEMPLATES,
  type ExportFormat,
  type ExportQuestion,
  type ImportFile,
  type ImportFormat,
  type ParsedQuestion,
  type ParseIssue,
  type TextLang,
} from "@/lib/exams/io";
import { cn } from "@/lib/utils";
import { Notice, type ExamLabels } from "./ExamShell";
import { signedUrls } from "./AssetManager";
import { QuestionPreview } from "./QuestionPreview";

type CheckItem = { index: number; ok: boolean; error: string | null; duplicateOf: string | null; duplicateInFile: number | null; categoryMissing: string[] };
type CheckResult = { items: CheckItem[]; counts: { total: number; valid: number; invalid: number; duplicates: number }; can: { categories: boolean; scenarios: boolean } };
type ImportRes = { index: number; ok: boolean; id?: string; error?: string; skipped?: boolean; warnings?: string[] };
const BATCH = 500;

function download(name: string, text: string | Blob, mime: string) {
  const blob = typeof text === "string" ? new Blob([text], { type: `${mime};charset=utf-8` }) : text;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** "invalid_question: correct_unknown_option" → label text */
function reasonText(raw: string | null | undefined, labels: ExamLabels): string {
  if (!raw) return "";
  const t = labels.bank.transfer;
  if (raw === "duplicate") return t.duplicateSkipped;
  const m = raw.match(/invalid_(?:question|category|scenario|asset|import): ([a-z_0-9]+)/);
  const key = m ? (/^right_min/.test(m[1]) ? "right_min" : m[1]) : raw.includes("forbidden") ? "forbidden" : "";
  return (labels.bank.errors as Record<string, string>)[key] ?? (m ? m[1] : raw.slice(0, 120));
}

function CategorySelects({ categories, value, onChange, locale, labels }: { categories: Category[]; value: { domainId: string; topicId: string; subtopicId: string }; onChange: (v: { domainId: string; topicId: string; subtopicId: string }) => void; locale: string; labels: ExamLabels }) {
  const e = labels.bank.editor;
  const doms = categories.filter((c) => c.kind === "DOMAIN");
  const tops = categories.filter((c) => c.kind === "TOPIC" && c.parentId === value.domainId);
  const subs = categories.filter((c) => c.kind === "SUBTOPIC" && c.parentId === value.topicId);
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <label className="block text-sm">
        <span className="field-label">{e.domain}</span>
        <select value={value.domainId} onChange={(ev) => onChange({ domainId: ev.target.value, topicId: "", subtopicId: "" })} className="field">
          <option value="">{e.none}</option>
          {doms.map((c) => <option key={c.id} value={c.id}>{catName(c, locale)}</option>)}
        </select>
      </label>
      <label className="block text-sm">
        <span className="field-label">{e.topic}</span>
        <select value={value.topicId} disabled={!value.domainId} onChange={(ev) => onChange({ ...value, topicId: ev.target.value, subtopicId: "" })} className="field">
          <option value="">{e.none}</option>
          {tops.map((c) => <option key={c.id} value={c.id}>{catName(c, locale)}</option>)}
        </select>
      </label>
      <label className="block text-sm">
        <span className="field-label">{e.subtopic}</span>
        <select value={value.subtopicId} disabled={!value.topicId} onChange={(ev) => onChange({ ...value, subtopicId: ev.target.value })} className="field">
          <option value="">{e.none}</option>
          {subs.map((c) => <option key={c.id} value={c.id}>{catName(c, locale)}</option>)}
        </select>
      </label>
    </div>
  );
}

/** preview card of one parsed question: learner view + answer key, built locally */
function toFull(p: ParsedQuestion): QuestionFull {
  return { ...blankQuestion(p.q.type), ...p.q, id: "", status: "DRAFT", version: 0, domainId: null, topicId: null, subtopicId: null, scenarioId: null } as QuestionFull;
}

export function BankTransfer({
  programId,
  courseCode,
  categories,
  can,
  selectedIds,
  onClearSelection,
  onImported,
  locale,
  labels,
}: {
  programId: string;
  courseCode: string;
  categories: Category[];
  can: { import: boolean; export: boolean; categories: boolean };
  selectedIds: string[];
  onClearSelection: () => void;
  onImported: () => void;
  locale: string;
  labels: ExamLabels;
}) {
  const t = labels.bank.transfer;
  return (
    <div className="space-y-8">
      {can.import ? <ImportPanel programId={programId} categories={categories} canCategories={can.categories} onImported={onImported} locale={locale} labels={labels} /> : <Notice>{t.noImport}</Notice>}
      {can.export ? <ExportPanel programId={programId} courseCode={courseCode} categories={categories} selectedIds={selectedIds} onClearSelection={onClearSelection} locale={locale} labels={labels} /> : <Notice>{t.noExport}</Notice>}
    </div>
  );
}

/* ───────────── import ───────────── */

function ImportPanel({ programId, categories, canCategories, onImported, locale, labels }: { programId: string; categories: Category[]; canCategories: boolean; onImported: () => void; locale: string; labels: ExamLabels }) {
  const t = labels.bank.transfer;
  const b = labels.bank;
  const [format, setFormat] = useState<ImportFormat | "">("");
  const [lang, setLang] = useState<TextLang>("auto");
  const [status, setStatus] = useState<"DRAFT" | "ACTIVE">("DRAFT");
  const [cats, setCats] = useState({ domainId: "", topicId: "", subtopicId: "" });
  const [useFileCats, setUseFileCats] = useState(true);
  const [createCats, setCreateCats] = useState(false);
  const [skipDup, setSkipDup] = useState(true);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [parsed, setParsed] = useState<{ questions: ParsedQuestion[]; issues: ParseIssue[]; format: ImportFormat } | null>(null);
  const [check, setCheck] = useState<CheckResult | null>(null);
  const [chosen, setChosen] = useState<Set<number>>(new Set());
  const [open, setOpen] = useState<number | null>(null);
  const [done, setDone] = useState<{ results: ImportRes[]; counts: { imported: number; failed: number; skipped: number; categoriesCreated: number; scenariosCreated: number }; files: { ok: number; failed: number } } | null>(null);

  const options = () => ({ status, ...cats, createCategories: createCats && canCategories, skipDuplicates: skipDup, format: parsed?.format, fileName: file?.name });
  const payload = (p: ParsedQuestion) => (useFileCats ? p.q : { ...p.q, category: undefined });

  const reset = () => {
    setParsed(null);
    setCheck(null);
    setChosen(new Set());
    setDone(null);
    setOpen(null);
    setError(null);
  };

  const read = async () => {
    if (!file) return;
    reset();
    if (file.size > MAX_IMPORT_BYTES) return setError(t.tooBig);
    setBusy(t.reading);
    try {
      const head = file.name.toLowerCase().endsWith(".xlsx") ? "" : (await file.slice(0, 4000).text());
      const fmt = format || detectFormat(file.name, head);
      const data = fmt === "xlsx" ? { buffer: await file.arrayBuffer() } : { text: await file.text() };
      const res = await parseFile(fmt, data, lang);
      setParsed({ ...res, format: fmt });
      if (!res.questions.length) return;
      setBusy(t.checking);
      // server dry run, in batches
      const items: CheckItem[] = [];
      const counts = { total: 0, valid: 0, invalid: 0, duplicates: 0 };
      let canFlags = { categories: false, scenarios: false };
      for (let i = 0; i < res.questions.length; i += BATCH) {
        const part = res.questions.slice(i, i + BATCH);
        const r = await rpc<CheckResult>("exam_bank_import_check", { p_program: programId, p_items: part.map((p) => (useFileCats ? p.q : { ...p.q, category: undefined })), p_options: { status, ...cats } });
        r.items.forEach((x) => items.push({ ...x, index: x.index + i, duplicateInFile: x.duplicateInFile === null ? null : x.duplicateInFile + i }));
        counts.total += r.counts.total;
        counts.valid += r.counts.valid;
        counts.invalid += r.counts.invalid;
        counts.duplicates += r.counts.duplicates;
        canFlags = r.can;
      }
      setCheck({ items, counts, can: canFlags });
      setChosen(new Set(items.filter((x) => x.ok && !x.duplicateOf && x.duplicateInFile === null).map((x) => x.index)));
    } catch (e) {
      setError(reasonText((e as Error).message, labels) || labels.errorGeneric);
    } finally {
      setBusy(null);
    }
  };

  const uploadFile = async (qid: string, f: ImportFile) => {
    const ext = ASSET_TYPES[f.mime];
    const bytes = base64ToBytes(f.base64);
    if (!ext || bytes.length === 0 || bytes.length > ASSET_MAX) return false;
    const path = `${programId}/${qid}/${crypto.randomUUID()}.${ext}`;
    const { error: upErr } = await supabase().storage.from(ASSET_BUCKET).upload(path, new Blob([bytes as BlobPart], { type: f.mime }), { contentType: f.mime, upsert: false });
    if (upErr) return false;
    try {
      await rpc("exam_asset_register", { p_owner_type: "QUESTION", p_owner_id: qid, p_path: path, p_mime: f.mime, p_size: bytes.length, p_file_name: f.name, p_caption_ar: f.captionAr ?? "", p_caption_en: f.captionEn ?? "" });
      return true;
    } catch {
      await supabase().storage.from(ASSET_BUCKET).remove([path]);
      return false;
    }
  };

  const runImport = async () => {
    if (!parsed) return;
    const picked = [...chosen].sort((a, b2) => a - b2);
    setBusy(t.importing);
    setError(null);
    try {
      const results: ImportRes[] = [];
      const counts = { imported: 0, failed: 0, skipped: 0, categoriesCreated: 0, scenariosCreated: 0 };
      for (let i = 0; i < picked.length; i += BATCH) {
        const idx = picked.slice(i, i + BATCH);
        const r = await rpc<{ results: ImportRes[]; counts: typeof counts }>("exam_bank_import", { p_program: programId, p_items: idx.map((k) => payload(parsed.questions[k])), p_options: options() });
        r.results.forEach((x) => results.push({ ...x, index: idx[x.index] }));
        (Object.keys(counts) as (keyof typeof counts)[]).forEach((k) => (counts[k] += r.counts[k] ?? 0));
      }
      // embedded images / PDFs → storage, attached to the new questions
      const files = { ok: 0, failed: 0 };
      const withFiles = results.filter((x) => x.ok && x.id && parsed.questions[x.index].files.length);
      for (const [n, x] of withFiles.entries()) {
        setBusy(`${t.uploading} ${n + 1}/${withFiles.length}`);
        for (const f of parsed.questions[x.index].files) (await uploadFile(x.id!, f)) ? files.ok++ : files.failed++;
      }
      setDone({ results, counts, files });
      onImported();
    } catch (e) {
      setError(reasonText((e as Error).message, labels) || labels.errorGeneric);
    } finally {
      setBusy(null);
    }
  };

  const byIndex = useMemo(() => new Map(check?.items.map((x) => [x.index, x]) ?? []), [check]);
  const selectable = check?.items.filter((x) => x.ok).map((x) => x.index) ?? [];
  const fmtLabel = (f: ImportFormat | ExportFormat) => t.formats[f];

  return (
    <section className="card space-y-5 p-5 sm:p-6">
      <div>
        <h2 className="text-xl font-bold">{t.importTitle}</h2>
        <p className="mt-1 text-sm text-slate">{t.importIntro}</p>
      </div>

      {!done && (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <label className="block text-sm sm:col-span-3">
              <span className="field-label">{t.file}</span>
              <input
                type="file"
                accept=".xml,.gift,.txt,.json,.csv,.tsv,.xlsx"
                onChange={(e) => {
                  setFile(e.target.files?.[0] ?? null);
                  reset();
                }}
                className="field"
              />
            </label>
            <label className="block text-sm">
              <span className="field-label">{t.format}</span>
              <select value={format} onChange={(e) => { setFormat(e.target.value as ImportFormat | ""); reset(); }} className="field">
                <option value="">{t.formatAuto}</option>
                {IMPORT_FORMATS.map((f) => <option key={f} value={f}>{fmtLabel(f)}</option>)}
              </select>
            </label>
            <label className="block text-sm">
              <span className="field-label">{t.textLang}</span>
              <select value={lang} onChange={(e) => { setLang(e.target.value as TextLang); reset(); }} className="field">
                <option value="auto">{t.langs.auto}</option>
                <option value="ar">{t.langs.ar}</option>
                <option value="en">{t.langs.en}</option>
              </select>
            </label>
            <label className="block text-sm">
              <span className="field-label">{t.importStatus}</span>
              <select value={status} onChange={(e) => { setStatus(e.target.value as "DRAFT" | "ACTIVE"); reset(); }} className="field">
                <option value="DRAFT">{b.statuses.DRAFT}</option>
                <option value="ACTIVE">{b.statuses.ACTIVE}</option>
              </select>
            </label>
          </div>
          <div className="space-y-2">
            <p className="field-label">{t.defaultCategory}</p>
            <CategorySelects categories={categories} value={cats} onChange={(v) => { setCats(v); reset(); }} locale={locale} labels={labels} />
            <div className="flex flex-col gap-2 pt-1 text-sm">
              <label className="flex items-center gap-2"><input type="checkbox" checked={useFileCats} onChange={(e) => { setUseFileCats(e.target.checked); reset(); }} className="h-4 w-4 accent-[var(--color-brand)]" />{t.useFileCats}</label>
              {canCategories && <label className="flex items-center gap-2"><input type="checkbox" checked={createCats} disabled={!useFileCats} onChange={(e) => setCreateCats(e.target.checked)} className="h-4 w-4 accent-[var(--color-brand)]" />{t.createCats}</label>}
              <label className="flex items-center gap-2"><input type="checkbox" checked={skipDup} onChange={(e) => setSkipDup(e.target.checked)} className="h-4 w-4 accent-[var(--color-brand)]" />{t.skipDup}</label>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" onClick={read} disabled={!file || !!busy} className="btn btn-primary">{busy ?? t.readFile}</button>
            <details className="text-sm">
              <summary className="cursor-pointer font-semibold text-brand">{t.templates}</summary>
              <div className="mt-2 flex flex-wrap gap-2">
                {(Object.keys(TEMPLATES) as (keyof typeof TEMPLATES)[]).map((k) => (
                  <button key={k} type="button" onClick={() => download(TEMPLATES[k].name, TEMPLATES[k].text(), TEMPLATES[k].mime)} className="btn btn-outline btn-sm">{fmtLabel(k)}</button>
                ))}
              </div>
              <p className="mt-2 text-xs text-slate">{t.templatesHint}</p>
            </details>
          </div>
          <p className="text-xs text-slate">{t.supportHint}</p>
        </>
      )}

      {error && <Notice tone="error">{error}</Notice>}

      {/* ── preview ── */}
      {parsed && !done && (
        <div className="space-y-4 border-t border-line pt-5">
          <div className="flex flex-wrap gap-2 text-sm">
            <span className="rounded-lg bg-mist px-3 py-1.5">{t.formatUsed}: <b>{fmtLabel(parsed.format)}</b></span>
            <span className="rounded-lg bg-mist px-3 py-1.5">{t.found}: <b>{parsed.questions.length}</b></span>
            {check && <span className="rounded-lg bg-emerald-50 px-3 py-1.5 text-emerald-700">{t.valid}: <b>{check.counts.valid}</b></span>}
            {check && check.counts.invalid > 0 && <span className="rounded-lg bg-gold/10 px-3 py-1.5 text-gold-600">{t.invalid}: <b>{check.counts.invalid}</b></span>}
            {check && check.counts.duplicates > 0 && <span className="rounded-lg bg-sky-50 px-3 py-1.5 text-navy">{t.duplicates}: <b>{check.counts.duplicates}</b></span>}
            {parsed.issues.length > 0 && <span className="rounded-lg bg-gold/10 px-3 py-1.5 text-gold-600">{t.unreadable}: <b>{parsed.issues.length}</b></span>}
          </div>

          {parsed.issues.length > 0 && (
            <details className="rounded-xl border border-gold/40 bg-gold/5 p-3 text-sm" open={!parsed.questions.length}>
              <summary className="cursor-pointer font-semibold text-gold-600">{t.unreadableTitle}</summary>
              <ul className="mt-2 space-y-1">
                {parsed.issues.map((x, i) => (
                  <li key={i}><span dir="ltr" className="font-mono text-xs text-slate">{x.source}</span> — {(t.reasons as Record<string, string>)[x.reason] ?? x.reason}{x.detail ? ` (${x.detail})` : ""}</li>
                ))}
              </ul>
            </details>
          )}

          {check && (
            <>
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <button type="button" onClick={() => setChosen(new Set(selectable))} className="btn btn-outline btn-sm">{t.selectAllValid}</button>
                <button type="button" onClick={() => setChosen(new Set())} className="btn btn-outline btn-sm">{t.selectNone}</button>
                <span className="text-slate">{t.chosen}: {chosen.size}</span>
              </div>
              <ul className="space-y-2">
                {parsed.questions.map((p, i) => {
                  const c = byIndex.get(i);
                  const warn = [...new Set(p.warnings.map((w) => w.split(":")[0]))];
                  return (
                    <li key={i} className={cn("rounded-xl border p-3", c?.ok ? "border-line bg-white" : "border-gold/40 bg-gold/5")}>
                      <div className="flex items-start gap-3">
                        <input type="checkbox" disabled={!c?.ok} checked={chosen.has(i)} onChange={(e) => { const n = new Set(chosen); if (e.target.checked) n.add(i); else n.delete(i); setChosen(n); }} className="mt-1 h-4 w-4 accent-[var(--color-brand)]" aria-label={`${t.pick} ${i + 1}`} />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-1.5 text-xs">
                            <span className="font-mono text-slate" dir="ltr">{p.source}</span>
                            <span className="rounded-md bg-navy px-2 py-0.5 font-semibold text-white">{b.types[p.q.type] ?? p.q.type}</span>
                            {c?.ok ? <span className="rounded-md bg-emerald-50 px-2 py-0.5 font-semibold text-emerald-700">{t.ok}</span> : <span className="rounded-md bg-gold/10 px-2 py-0.5 font-semibold text-gold-600">{reasonText(c?.error, labels)}</span>}
                            {c?.duplicateOf && <span className="rounded-md bg-sky-50 px-2 py-0.5 text-navy">{t.dupInBank}</span>}
                            {c?.duplicateInFile !== null && c?.duplicateInFile !== undefined && <span className="rounded-md bg-sky-50 px-2 py-0.5 text-navy">{t.dupInFile.replace("{n}", parsed.questions[c.duplicateInFile]?.source ?? "")}</span>}
                            {useFileCats && p.q.category?.domain && <span className="rounded-md bg-mist px-2 py-0.5 text-slate">{[p.q.category.domain, p.q.category.topic, p.q.category.subtopic].filter(Boolean).join(" › ")}</span>}
                            {useFileCats && (c?.categoryMissing?.length ?? 0) > 0 && <span className="rounded-md bg-gold/10 px-2 py-0.5 text-gold-600">{createCats && canCategories ? t.catWillCreate : t.catMissing}</span>}
                            {p.q.scenario && <span className="rounded-md bg-brand/10 px-2 py-0.5 text-brand">{b.scenarios.caseLabel}: {p.q.scenario.titleAr || p.q.scenario.titleEn}</span>}
                            {p.files.length > 0 && <span className="rounded-md bg-mist px-2 py-0.5 text-slate">{t.filesN.replace("{n}", String(p.files.length))}</span>}
                            {warn.map((w) => <span key={w} className="rounded-md bg-mist px-2 py-0.5 text-slate">{(t.warnings as Record<string, string>)[w] ?? w}</span>)}
                          </div>
                          <p className="mt-1 line-clamp-2 text-sm leading-7 text-navy">{(locale === "ar" ? p.q.stemAr || p.q.stemEn : p.q.stemEn || p.q.stemAr) || "—"}</p>
                          <button type="button" onClick={() => setOpen(open === i ? null : i)} className="mt-1 text-sm font-semibold text-brand hover:underline">{open === i ? t.hide : b.preview}</button>
                          {open === i && <div className="mt-3 rounded-xl bg-mist p-3"><QuestionPreview q={toFull(p)} locale={locale} labels={labels} /></div>}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
              <div className="flex flex-wrap items-center gap-3">
                <button type="button" onClick={runImport} disabled={!chosen.size || !!busy} className="btn btn-primary">{busy ?? t.importN.replace("{n}", String(chosen.size))}</button>
                <button type="button" onClick={reset} disabled={!!busy} className="btn btn-outline">{t.cancel}</button>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── report ── */}
      {done && parsed && (
        <div className="space-y-4">
          <Notice tone={done.counts.failed ? "error" : "success"}>
            {t.reportLine.replace("{ok}", String(done.counts.imported)).replace("{bad}", String(done.counts.failed)).replace("{skip}", String(done.counts.skipped))}
            {done.counts.categoriesCreated > 0 && ` · ${t.catsCreated.replace("{n}", String(done.counts.categoriesCreated))}`}
            {done.counts.scenariosCreated > 0 && ` · ${t.scnCreated.replace("{n}", String(done.counts.scenariosCreated))}`}
            {done.files.ok + done.files.failed > 0 && ` · ${t.filesReport.replace("{ok}", String(done.files.ok)).replace("{bad}", String(done.files.failed))}`}
          </Notice>
          {done.results.some((x) => !x.ok) && (
            <div className="rounded-xl border border-line p-3 text-sm">
              <p className="font-semibold text-navy">{t.failedTitle}</p>
              <ul className="mt-2 space-y-1">
                {done.results.filter((x) => !x.ok).map((x) => (
                  <li key={x.index}><span className="font-mono text-xs text-slate" dir="ltr">{parsed.questions[x.index]?.source}</span> — {reasonText(x.error, labels)}</li>
                ))}
              </ul>
            </div>
          )}
          {done.results.some((x) => x.ok && x.warnings?.length) && (
            <ul className="space-y-1 text-sm text-slate">
              {done.results.filter((x) => x.ok && x.warnings?.length).map((x) => (
                <li key={x.index}><span className="font-mono text-xs" dir="ltr">{parsed.questions[x.index]?.source}</span> — {x.warnings!.map((w) => (t.warnings as Record<string, string>)[w] ?? w).join("، ")}</li>
              ))}
            </ul>
          )}
          <button type="button" onClick={() => { reset(); setFile(null); }} className="btn btn-outline">{t.another}</button>
        </div>
      )}
    </section>
  );
}

/* ───────────── export ───────────── */

function ExportPanel({ programId, courseCode, categories, selectedIds, onClearSelection, locale, labels }: { programId: string; courseCode: string; categories: Category[]; selectedIds: string[]; onClearSelection: () => void; locale: string; labels: ExamLabels }) {
  const t = labels.bank.transfer;
  const b = labels.bank;
  const [scope, setScope] = useState<"bank" | "category" | "selection">(selectedIds.length ? "selection" : "bank");
  const [categoryId, setCategoryId] = useState("");
  const [status, setStatus] = useState("");
  const [format, setFormat] = useState<ExportFormat>("moodle");
  const [lang, setLang] = useState<"ar" | "en">(locale === "en" ? "en" : "ar");
  const [withFiles, setWithFiles] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ exported: number; skipped: { id: string; type: string; reason: string }[]; filesSkipped: number } | null>(null);
  const filesOk = format === "moodle" || format === "json";
  const oneLang = format !== "json" && format !== "csv";

  const run = async () => {
    setBusy(t.exporting);
    setError(null);
    setResult(null);
    try {
      const filter = { format, status, ...(scope === "category" ? { categoryId } : {}), ...(scope === "selection" ? { ids: selectedIds } : {}) };
      const { questions } = await rpc<{ questions: ExportQuestion[] }>("exam_bank_export", { p_program: programId, p_filter: filter });
      const files: Record<string, string> = {};
      let filesSkipped = 0;
      if (filesOk && withFiles) {
        const paths = [...new Set(questions.flatMap((q) => q.attachments.map((a) => a.path)))];
        let total = 0;
        for (let i = 0; i < paths.length; i += 50) {
          setBusy(`${t.fetchingFiles} ${Math.min(i + 50, paths.length)}/${paths.length}`);
          const urls = await signedUrls(paths.slice(i, i + 50), 600);
          for (const pth of paths.slice(i, i + 50)) {
            try {
              const res = await fetch(urls[pth]);
              const buf = new Uint8Array(await res.arrayBuffer());
              if (!res.ok || total + buf.length > 60 * 1024 * 1024) {
                filesSkipped++;
                continue;
              }
              total += buf.length;
              files[pth] = bytesToBase64(buf);
            } catch {
              filesSkipped++;
            }
          }
        }
      }
      const out = exportAs(format, questions, lang, files, { code: courseCode });
      if (out.exported > 0) download(`${courseCode || "bank"}-questions-${new Date().toISOString().slice(0, 10)}.${out.ext}`, out.text, out.mime);
      setResult({ exported: out.exported, skipped: out.skipped, filesSkipped });
    } catch (e) {
      setError(reasonText((e as Error).message, labels) || labels.errorGeneric);
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="card space-y-5 p-5 sm:p-6">
      <div>
        <h2 className="text-xl font-bold">{t.exportTitle}</h2>
        <p className="mt-1 text-sm text-slate">{t.exportIntro}</p>
      </div>
      <fieldset className="space-y-2 text-sm">
        <legend className="field-label">{t.scope}</legend>
        <label className="flex items-center gap-2"><input type="radio" checked={scope === "bank"} onChange={() => setScope("bank")} className="h-4 w-4 accent-[var(--color-brand)]" />{t.scopes.bank}</label>
        <label className="flex flex-wrap items-center gap-2">
          <input type="radio" checked={scope === "category"} onChange={() => setScope("category")} className="h-4 w-4 accent-[var(--color-brand)]" />{t.scopes.category}
          {scope === "category" && (
            <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className="field w-auto py-1.5">
              <option value="">—</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.kind === "DOMAIN" ? "" : c.kind === "TOPIC" ? "— " : "—— "}{catName(c, locale)}</option>)}
            </select>
          )}
        </label>
        <label className={cn("flex flex-wrap items-center gap-2", !selectedIds.length && "opacity-60")}>
          <input type="radio" disabled={!selectedIds.length} checked={scope === "selection"} onChange={() => setScope("selection")} className="h-4 w-4 accent-[var(--color-brand)]" />
          {t.scopes.selection.replace("{n}", String(selectedIds.length))}
          {selectedIds.length > 0 && <button type="button" onClick={() => { onClearSelection(); setScope("bank"); }} className="text-xs text-gold-600 hover:underline">{t.clearSelection}</button>}
        </label>
        {!selectedIds.length && <p className="text-xs text-slate">{t.selectionHint}</p>}
      </fieldset>
      <div className="grid gap-4 sm:grid-cols-3">
        <label className="block text-sm">
          <span className="field-label">{t.format}</span>
          <select value={format} onChange={(e) => setFormat(e.target.value as ExportFormat)} className="field">
            {EXPORT_FORMATS.map((f) => <option key={f} value={f}>{t.formats[f]}</option>)}
          </select>
        </label>
        <label className="block text-sm">
          <span className="field-label">{b.statuses.ACTIVE} / {b.statuses.DRAFT}</span>
          <select value={status} onChange={(e) => setStatus(e.target.value)} className="field">
            <option value="">{b.allStatuses}</option>
            {(["ACTIVE", "DRAFT", "DISABLED"] as const).map((s) => <option key={s} value={s}>{b.statuses[s]}</option>)}
          </select>
        </label>
        {oneLang && (
          <label className="block text-sm">
            <span className="field-label">{t.exportLang}</span>
            <select value={lang} onChange={(e) => setLang(e.target.value as "ar" | "en")} className="field">
              <option value="ar">{t.langs.ar}</option>
              <option value="en">{t.langs.en}</option>
            </select>
          </label>
        )}
      </div>
      <p className="rounded-xl bg-mist px-4 py-3 text-sm text-slate">
        {t.typesIn.replace("{f}", t.formats[format])}: {FORMAT_TYPES[format].map((x) => b.types[x]).join("، ")}. {t.formatNotes[format]}
      </p>
      {filesOk && (
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={withFiles} onChange={(e) => setWithFiles(e.target.checked)} className="h-4 w-4 accent-[var(--color-brand)]" />{t.withFiles}</label>
      )}
      <p className="text-xs text-slate">{t.exportNote}</p>
      {error && <Notice tone="error">{error}</Notice>}
      <button type="button" onClick={run} disabled={!!busy || (scope === "category" && !categoryId)} className="btn btn-primary">{busy ?? t.exportBtn}</button>
      {result && (
        <div className="space-y-2">
          <Notice tone={result.exported ? "success" : "error"}>
            {result.exported ? t.exportedN.replace("{n}", String(result.exported)) : t.nothingExported}
            {result.filesSkipped > 0 && ` · ${t.filesSkipped.replace("{n}", String(result.filesSkipped))}`}
          </Notice>
          {result.skipped.length > 0 && (
            <p className="text-sm text-slate">
              {t.skippedN.replace("{n}", String(result.skipped.length))}:{" "}
              {[...new Set(result.skipped.map((s) => `${b.types[s.type as keyof typeof b.types]} (${(t.reasons as Record<string, string>)[s.reason] ?? s.reason})`))].join("، ")}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
