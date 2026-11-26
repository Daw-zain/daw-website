/**
 * JSON (our documented, lossless format), CSV and Excel (.xlsx) import/export.
 *   JSON: every type, both languages, feedback, explanation, option rationale, categories, scenarios, figures and
 *         (optionally) attachments as base64.
 *   CSV / Excel: simple types only (MCQ, MULTI, TRUE_FALSE, NUMERIC, SHORT, ESSAY, ORDERING) — one row per question.
 */
import type { QuestionType } from "../bank";
import {
  blankImport,
  item,
  mimeOf,
  pickLang,
  type ExportQuestion,
  type ExportResult,
  type ImportFile,
  type ImportQuestion,
  type ParseResult,
  type TextLang,
} from "./types";
import { deepText, kid, kids, parseXml, type XNode } from "./xml";

/* ───────────── JSON ───────────── */

export const JSON_FORMAT = "daleel-questions";

export function parseJsonQuestions(src: string): ParseResult {
  let data: unknown;
  try {
    data = JSON.parse(src.replace(/^﻿/, ""));
  } catch (e) {
    return { questions: [], issues: [{ source: "file", reason: "bad_json", detail: (e as Error).message.slice(0, 120) }] };
  }
  const list = Array.isArray(data) ? data : (data as { questions?: unknown })?.questions;
  if (!Array.isArray(list)) return { questions: [], issues: [{ source: "file", reason: "bad_json", detail: "questions[]" }] };
  const res: ParseResult = { questions: [], issues: [] };
  list.forEach((raw, i) => {
    const source = `#${i + 1}`;
    if (!raw || typeof raw !== "object" || typeof (raw as { type?: unknown }).type !== "string") {
      res.issues.push({ source, reason: "bad_item" });
      return;
    }
    const r = raw as Partial<ImportQuestion> & { attachments?: { fileName?: string; mime?: string; data?: string; captionAr?: string; captionEn?: string }[] };
    const q: ImportQuestion = {
      ...blankImport(r.type as QuestionType, "ar", ""),
      ...r,
      stemAr: String(r.stemAr ?? ""),
      stemEn: String(r.stemEn ?? ""),
      content: (r.content ?? {}) as ImportQuestion["content"],
      answer: (r.answer ?? {}) as ImportQuestion["answer"],
      scoring: r.scoring ?? { mode: r.type === "ESSAY" ? "MANUAL" : "ALL_OR_NOTHING" },
      keywords: Array.isArray(r.keywords) ? r.keywords.map(String) : [],
      optionRationale: (r.optionRationale ?? {}) as ImportQuestion["optionRationale"],
    };
    delete (q as { attachments?: unknown }).attachments;
    const files: ImportFile[] = (r.attachments ?? [])
      .filter((a) => typeof a?.data === "string" && a.data)
      .map((a) => ({ name: a.fileName || "file", mime: a.mime || mimeOf(a.fileName ?? ""), base64: a.data as string, captionAr: a.captionAr, captionEn: a.captionEn }))
      .filter((f) => !!mimeOf(f.name) || /^(image\/(png|jpeg|webp|gif)|application\/pdf)$/.test(f.mime));
    res.questions.push({ q, source, warnings: [], files });
  });
  return res;
}

export function exportJson(qs: ExportQuestion[], files: Record<string, string> = {}, course?: { code?: string | null; title?: string }): ExportResult {
  const questions = qs.map((q) => {
    const { id: _id, status: _s, version: _v, attachments, ...rest } = q;
    void _id;
    void _s;
    void _v;
    return {
      ...rest,
      attachments: attachments.map((a) => ({ fileName: a.fileName, mime: a.mime, kind: a.kind, captionAr: a.captionAr, captionEn: a.captionEn, ...(files[a.path] ? { data: files[a.path] } : {}) })),
    };
  });
  const doc = { format: JSON_FORMAT, version: 1, exportedAt: new Date().toISOString(), course, count: questions.length, questions };
  return { text: JSON.stringify(doc, null, 2), mime: "application/json", ext: "json", exported: qs.length, skipped: [] };
}

/* ───────────── CSV ───────────── */

export const CSV_COLUMNS = [
  "type",
  "stem_ar",
  "stem_en",
  "options_ar",
  "options_en",
  "correct",
  "tolerance",
  "points",
  "difficulty",
  "domain",
  "topic",
  "subtopic",
  "feedback_ar",
  "feedback_en",
  "explanation_ar",
  "explanation_en",
  "reference",
  "keywords",
] as const;

/** RFC 4180 CSV (quotes, doubled quotes, newlines in quotes). The delimiter is detected: , ; or tab */
export function parseCsvRows(src: string): string[][] {
  const s = src.replace(/^﻿/, "");
  const firstLine = s.slice(0, s.search(/\r?\n/) >>> 0 || s.length);
  const delim = [",", ";", "\t"].map((d) => ({ d, n: firstLine.split(d).length })).sort((a, b) => b.n - a.n)[0].d;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let q = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"' && s[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"' && cell === "") q = true;
    else if (c === delim) {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((x) => x.trim() !== ""));
}

const TYPE_ALIASES: Record<string, QuestionType> = {
  mcq: "MCQ", mc: "MCQ", multichoice: "MCQ", "اختيار من متعدد": "MCQ",
  multi: "MULTI", multiple_response: "MULTI", "متعدد الاستجابات": "MULTI",
  true_false: "TRUE_FALSE", truefalse: "TRUE_FALSE", tf: "TRUE_FALSE", "صح/خطأ": "TRUE_FALSE", "صح أو خطأ": "TRUE_FALSE",
  numeric: "NUMERIC", numerical: "NUMERIC", "رقمي": "NUMERIC",
  short: "SHORT", shortanswer: "SHORT", "إجابة قصيرة": "SHORT",
  essay: "ESSAY", "مقالي": "ESSAY",
  ordering: "ORDERING", order: "ORDERING", "ترتيب": "ORDERING",
};
const split = (s: string) => s.split("|").map((x) => x.trim()).filter(Boolean);
/** "B" / "2" / "B|D" / "2,4" → option indexes */
const letters = (s: string) =>
  s
    .split(/[|,،;\s]+/)
    .map((x) => x.trim())
    .filter(Boolean)
    .map((x) => (/^\d+$/.test(x) ? Number(x) - 1 : /^[A-Za-z]$/.test(x) ? x.toUpperCase().charCodeAt(0) - 65 : -1));

/** rows (first = header) → questions; used for CSV and Excel alike */
export function rowsToQuestions(rows: string[][], lang: TextLang = "auto"): ParseResult {
  const res: ParseResult = { questions: [], issues: [] };
  if (!rows.length) return { questions: [], issues: [{ source: "file", reason: "empty_file" }] };
  const head = rows[0].map((h) => h.trim().toLowerCase().replace(/\s+/g, "_"));
  const col = (name: (typeof CSV_COLUMNS)[number]) => head.indexOf(name);
  if (col("type") < 0 || (col("stem_ar") < 0 && col("stem_en") < 0)) return { questions: [], issues: [{ source: "file", reason: "missing_columns", detail: "type, stem_ar / stem_en" }] };
  rows.slice(1).forEach((r, i) => {
    const source = `L${i + 2}`;
    const get = (name: (typeof CSV_COLUMNS)[number]) => (col(name) >= 0 ? (r[col(name)] ?? "").trim() : "");
    const type = TYPE_ALIASES[get("type").toLowerCase()] ?? (get("type").toUpperCase() as QuestionType);
    if (!["MCQ", "MULTI", "TRUE_FALSE", "NUMERIC", "SHORT", "ESSAY", "ORDERING"].includes(type)) {
      res.issues.push({ source, reason: "unsupported_type", detail: get("type") || "—" });
      return;
    }
    const stemAr = get("stem_ar");
    const stemEn = get("stem_en");
    if (!stemAr && !stemEn) {
      res.issues.push({ source, reason: "no_stem" });
      return;
    }
    const L = lang === "auto" ? (stemAr ? "ar" : "en") : pickLang(lang, stemAr || stemEn);
    const q = blankImport(type, L, "");
    q.stemAr = stemAr;
    q.stemEn = stemEn;
    const optAr = split(get("options_ar"));
    const optEn = split(get("options_en"));
    const opts = Array.from({ length: Math.max(optAr.length, optEn.length) }, (_, k) => ({ ...item("", L), textAr: optAr[k] ?? "", textEn: optEn[k] ?? "" }));
    const correct = get("correct");
    const warnings: string[] = [];
    switch (type) {
      case "MCQ":
      case "MULTI": {
        const idx = letters(correct);
        if (!idx.length || idx.some((k) => k < 0 || k >= opts.length)) {
          res.issues.push({ source, reason: "no_correct_answer", detail: correct || "—" });
          return;
        }
        q.content = { options: opts };
        q.answer = { correct: [...new Set(idx)].map((k) => opts[k].id) };
        if (type === "MULTI") q.scoring = { mode: "PARTIAL" };
        break;
      }
      case "TRUE_FALSE": {
        const v = correct.toLowerCase();
        if (!["true", "false", "t", "f", "صح", "خطأ", "صحيح", "خاطئ", "1", "0"].includes(v)) {
          res.issues.push({ source, reason: "no_correct_answer", detail: correct || "—" });
          return;
        }
        q.answer = { value: ["true", "t", "صح", "صحيح", "1"].includes(v) };
        break;
      }
      case "NUMERIC": {
        const v = Number(correct.replace(",", "."));
        if (correct === "" || !Number.isFinite(v)) {
          res.issues.push({ source, reason: "no_correct_answer", detail: correct || "—" });
          return;
        }
        q.answer = { value: v, tolerance: Math.abs(Number(get("tolerance").replace(",", ".")) || 0) };
        break;
      }
      case "SHORT":
        q.answer = { accepted: split(correct), caseSensitive: false };
        if (!q.answer.accepted?.length) {
          res.issues.push({ source, reason: "no_correct_answer" });
          return;
        }
        break;
      case "ESSAY":
        q.answer = L === "ar" ? { rubricAr: correct, rubricEn: "" } : { rubricAr: "", rubricEn: correct };
        break;
      case "ORDERING":
        q.content = { items: opts };
        q.scoring = { mode: "PARTIAL" };
        break;
    }
    const pts = Number(get("points").replace(",", "."));
    if (get("points") && pts > 0) q.points = pts;
    const d = get("difficulty").toUpperCase();
    q.difficulty = (({ EASY: "EASY", MEDIUM: "MEDIUM", HARD: "HARD", "سهل": "EASY", "متوسط": "MEDIUM", "صعب": "HARD" }) as Record<string, ImportQuestion["difficulty"]>)[d] ?? (get("difficulty") ? (warnings.push("difficulty_default"), "MEDIUM") : "MEDIUM");
    if (get("domain")) q.category = { domain: get("domain"), topic: get("topic") || undefined, subtopic: get("subtopic") || undefined };
    q.feedbackAr = get("feedback_ar");
    q.feedbackEn = get("feedback_en");
    q.explanationAr = get("explanation_ar");
    q.explanationEn = get("explanation_en");
    q.reference = get("reference");
    q.keywords = get("keywords").split(/[,،|]/).map((k) => k.trim()).filter(Boolean);
    res.questions.push({ q, source, warnings, files: [] });
  });
  return res;
}

const csvCell = (v: string | number) => {
  const s = String(v ?? "");
  return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export const toCsv = (rows: (string | number)[][]) => "﻿" + rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";

export function exportCsv(qs: ExportQuestion[]): ExportResult {
  const rows: (string | number)[][] = [[...CSV_COLUMNS]];
  const skipped: ExportResult["skipped"] = [];
  for (const q of qs) {
    if (!["MCQ", "MULTI", "TRUE_FALSE", "NUMERIC", "SHORT", "ESSAY", "ORDERING"].includes(q.type)) {
      skipped.push({ id: q.id, type: q.type, reason: "type_not_supported" });
      continue;
    }
    const list = q.type === "ORDERING" ? q.content.items ?? [] : q.content.options ?? [];
    let correct = "";
    if (q.type === "MCQ" || q.type === "MULTI") correct = (q.answer.correct ?? []).map((id) => String.fromCharCode(65 + list.findIndex((o) => o.id === id))).join("|");
    if (q.type === "TRUE_FALSE") correct = q.answer.value ? "TRUE" : "FALSE";
    if (q.type === "NUMERIC") correct = String(q.answer.value ?? "");
    if (q.type === "SHORT") correct = (q.answer.accepted ?? []).join("|");
    if (q.type === "ESSAY") correct = q.answer.rubricAr || q.answer.rubricEn || "";
    rows.push([
      q.type,
      q.stemAr,
      q.stemEn,
      list.map((o) => o.textAr).join("|"),
      list.some((o) => o.textEn) ? list.map((o) => o.textEn).join("|") : "",
      correct,
      q.type === "NUMERIC" ? q.answer.tolerance ?? 0 : "",
      q.points,
      q.difficulty,
      q.category?.domain ?? "",
      q.category?.topic ?? "",
      q.category?.subtopic ?? "",
      q.feedbackAr,
      q.feedbackEn,
      q.explanationAr,
      q.explanationEn,
      q.reference,
      q.keywords.join(", "),
    ]);
  }
  return { text: toCsv(rows), mime: "text/csv", ext: "csv", exported: rows.length - 1, skipped };
}

/** CSV template with one example row per supported type */
export function csvTemplate(): string {
  return toCsv([
    [...CSV_COLUMNS],
    ["MCQ", "ما المخرج الرئيسي لعملية تطوير ميثاق المشروع؟", "", "خطة المشروع|ميثاق المشروع|سجل المخاطر|بيان النطاق", "", "B", "", 1, "EASY", "البدء", "", "", "", "", "الميثاق يخوّل المشروع رسميًا.", "", "PMBOK 7", "ميثاق"],
    ["MULTI", "اختر عمليتين من مجموعة التخطيط", "", "تحديد النطاق|إغلاق المشروع|إنشاء هيكل تجزئة العمل|توجيه العمل", "", "A|C", "", 2, "MEDIUM", "التخطيط", "", "", "", "", "", "", "", ""],
    ["TRUE_FALSE", "سجل المخاطر مخرج من مخرجات عملية تحديد المخاطر.", "", "", "", "TRUE", "", 1, "EASY", "", "", "", "", "", "", "", "", ""],
    ["NUMERIC", "إذا كانت القيمة المخططة 100 والقيمة المكتسبة 80، فما مؤشر أداء الجدول؟", "", "", "", "0.8", "0.01", 1, "MEDIUM", "", "", "", "", "", "SPI = EV / PV", "", "", ""],
    ["SHORT", "ما اختصار هيكل تجزئة العمل بالإنجليزية؟", "", "", "", "WBS|W.B.S", "", 1, "EASY", "", "", "", "", "", "", "", "", ""],
    ["ESSAY", "اشرح الفرق بين المخاطر والقضايا.", "", "", "", "يذكر أن المخاطر أحداث محتملة والقضايا وقعت فعلًا.", "", 4, "HARD", "", "", "", "", "", "", "", "", ""],
    ["ORDERING", "رتّب مجموعات العمليات", "", "البدء|التخطيط|التنفيذ|المراقبة والتحكم|الإغلاق", "", "", "", 2, "MEDIUM", "", "", "", "", "", "", "", "", ""],
  ]);
}

/* ───────────── Excel (.xlsx) — minimal reader, no library ───────────── */

const MAX_UNZIPPED = 30 * 1024 * 1024;

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream("deflate-raw");
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(ds);
  const reader = stream.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > MAX_UNZIPPED) {
      await reader.cancel();
      throw new Error("file_too_large");
    }
    parts.push(value);
  }
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** files inside a zip (only the ones asked for) */
async function unzip(buf: ArrayBuffer, wanted: (name: string) => boolean): Promise<Record<string, string>> {
  const b = new Uint8Array(buf);
  const dv = new DataView(buf);
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("not_xlsx");
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const out: Record<string, string> = {};
  const dec = new TextDecoder();
  for (let k = 0; k < count && p + 46 <= b.length; k++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error("not_xlsx");
    const method = dv.getUint16(p + 10, true);
    const csize = dv.getUint32(p + 20, true);
    const nlen = dv.getUint16(p + 28, true);
    const xlen = dv.getUint16(p + 30, true);
    const clen = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    const name = dec.decode(b.subarray(p + 46, p + 46 + nlen));
    p += 46 + nlen + xlen + clen;
    if (!wanted(name)) continue;
    const lnlen = dv.getUint16(local + 26, true);
    const lxlen = dv.getUint16(local + 28, true);
    const start = local + 30 + lnlen + lxlen;
    const raw = b.subarray(start, start + csize);
    const data = method === 0 ? raw : method === 8 ? await inflate(raw) : null;
    if (data) out[name] = dec.decode(data);
  }
  return out;
}

const colIndex = (ref: string) => {
  const letters = ref.match(/^[A-Z]+/)?.[0] ?? "A";
  return [...letters].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
};

/** first worksheet of an .xlsx file → rows of text */
export async function readXlsx(buf: ArrayBuffer): Promise<string[][]> {
  const files = await unzip(buf, (n) => n === "xl/workbook.xml" || n === "xl/_rels/workbook.xml.rels" || n === "xl/sharedStrings.xml" || /^xl\/worksheets\/sheet\d+\.xml$/.test(n));
  // first sheet in workbook order
  let sheetPath = "xl/worksheets/sheet1.xml";
  try {
    const wb = parseXml(files["xl/workbook.xml"] ?? "");
    const first = kids(kid(kid(wb, "workbook"), "sheets"), "sheet")[0];
    const rid = first?.attrs["r:id"];
    const rels = parseXml(files["xl/_rels/workbook.xml.rels"] ?? "");
    const target = kids(kid(rels, "Relationships"), "Relationship").find((r) => r.attrs.Id === rid)?.attrs.Target;
    if (target) sheetPath = target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\.\//, "")}`;
  } catch {
    /* fall back to sheet1 */
  }
  const shared = files["xl/sharedStrings.xml"] ? kids(kid(parseXml(files["xl/sharedStrings.xml"]), "sst"), "si").map((si: XNode) => deepText(si)) : [];
  const sheetXml = files[sheetPath];
  if (!sheetXml) throw new Error("not_xlsx");
  const rows: string[][] = [];
  for (const r of kids(kid(kid(parseXml(sheetXml), "worksheet"), "sheetData"), "row")) {
    const row: string[] = [];
    for (const c of kids(r, "c")) {
      const t = c.attrs.t;
      const v = kid(c, "v")?.text ?? "";
      const val = t === "s" ? shared[Number(v)] ?? "" : t === "inlineStr" ? deepText(kid(c, "is") ?? { name: "", attrs: {}, children: [], text: "" }) : t === "b" ? (v === "1" ? "TRUE" : "FALSE") : v;
      row[c.attrs.r ? colIndex(c.attrs.r) : row.length] = val;
    }
    rows.push(Array.from(row, (x) => x ?? ""));
    if (rows.length > 5000) break;
  }
  return rows.filter((r) => r.some((x) => x.trim() !== ""));
}

