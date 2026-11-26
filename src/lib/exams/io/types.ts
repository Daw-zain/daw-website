/**
 * Phase 11 — import / export. Shared shapes.
 * Pure TypeScript (no browser APIs, no React) so the parsers can be tested with `tsx` in Node.
 */
import type { Difficulty, Figure, QuestionAnswer, QuestionContent, QuestionType, ScoringMode } from "../bank";

export const IMPORT_FORMATS = ["moodle", "gift", "aiken", "json", "csv", "xlsx"] as const;
export type ImportFormat = (typeof IMPORT_FORMATS)[number];
export const EXPORT_FORMATS = ["moodle", "json", "gift", "aiken", "csv"] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

/** which of our types each format can carry (import and export). "Don't claim types a format doesn't support." */
export const FORMAT_TYPES: Record<ImportFormat | ExportFormat, QuestionType[]> = {
  moodle: ["MCQ", "MULTI", "TRUE_FALSE", "NUMERIC", "SHORT", "ESSAY", "MATCHING", "ORDERING", "CLOZE", "DRAGDROP"],
  gift: ["MCQ", "MULTI", "TRUE_FALSE", "NUMERIC", "SHORT", "ESSAY", "MATCHING"],
  aiken: ["MCQ"],
  json: ["MCQ", "MULTI", "TRUE_FALSE", "NUMERIC", "SHORT", "ESSAY", "ORDERING", "MATCHING", "HOTSPOT", "DRAGDROP", "CLOZE"],
  csv: ["MCQ", "MULTI", "TRUE_FALSE", "NUMERIC", "SHORT", "ESSAY", "ORDERING"],
  xlsx: ["MCQ", "MULTI", "TRUE_FALSE", "NUMERIC", "SHORT", "ESSAY", "ORDERING"],
};

export type ImportScenario = {
  key: string;
  titleAr: string;
  titleEn: string;
  bodyAr: string;
  bodyEn: string;
  details?: unknown;
  tables?: unknown;
  displayMode?: "SIDE" | "SECTION";
};

/** one question as the server's import functions expect it (= the editor's save payload, without ids) */
export type ImportQuestion = {
  type: QuestionType;
  stemAr: string;
  stemEn: string;
  content: QuestionContent & { figure?: Figure };
  answer: QuestionAnswer;
  scoring: { mode?: ScoringMode | "MANUAL" };
  points: number;
  weight: number;
  difficulty: Difficulty;
  keywords: string[];
  reference: string;
  feedbackAr: string;
  feedbackEn: string;
  explanationAr: string;
  explanationEn: string;
  optionRationale: Record<string, { ar?: string; en?: string }>;
  category?: { domain?: string; topic?: string; subtopic?: string };
  scenario?: ImportScenario;
};

/** a file embedded in the source (Moodle XML <file>, JSON attachments) — uploaded after the question exists */
export type ImportFile = { name: string; mime: string; base64: string; captionAr?: string; captionEn?: string };

export type ParsedQuestion = { q: ImportQuestion; source: string; warnings: string[]; files: ImportFile[] };
/** a part of the file that could not become a question, and why (key into labels + detail) */
export type ParseIssue = { source: string; reason: string; detail?: string };
export type ParseResult = { questions: ParsedQuestion[]; issues: ParseIssue[] };

/** what the export function returns per question (full question + names + files list) */
export type ExportQuestion = ImportQuestion & {
  id: string;
  status: string;
  version: number;
  attachments: { path: string; mime: string; fileName: string; captionAr: string; captionEn: string; kind: "IMAGE" | "FILE" }[];
};
export type ExportResult = { text: string; mime: string; ext: string; exported: number; skipped: { id: string; type: QuestionType; reason: string }[] };

/** text language for files that carry one language: "auto" = Arabic letters → Arabic fields */
export type TextLang = "auto" | "ar" | "en";
export const hasArabic = (s: string) => /[؀-ۿ]/.test(s);
export const pickLang = (lang: TextLang, sample: string): "ar" | "en" => (lang === "auto" ? (hasArabic(sample) ? "ar" : "en") : lang);
/** the text of a bilingual pair in the export language (falls back to the other one) */
export const inLang = (ar: string | undefined, en: string | undefined, lang: "ar" | "en") => (lang === "ar" ? ar || en : en || ar) ?? "";

let seq = 0;
export const newId = (p = "i") => `${p}${Date.now().toString(36).slice(-4)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 5)}`;

export function blankImport(type: QuestionType, lang: "ar" | "en", stem: string): ImportQuestion {
  return {
    type,
    stemAr: lang === "ar" ? stem : "",
    stemEn: lang === "en" ? stem : "",
    content: {},
    answer: {},
    scoring: { mode: type === "ESSAY" ? "MANUAL" : "ALL_OR_NOTHING" },
    points: 1,
    weight: 1,
    difficulty: "MEDIUM",
    keywords: [],
    reference: "",
    feedbackAr: "",
    feedbackEn: "",
    explanationAr: "",
    explanationEn: "",
    optionRationale: {},
  };
}

/** {textAr,textEn} item in the question's language */
export const item = (text: string, lang: "ar" | "en", id = newId("o")) => ({ id, textAr: lang === "ar" ? text : "", textEn: lang === "en" ? text : "" });
export const setText = <T extends { feedbackAr: string; feedbackEn: string }>(q: T, key: "feedback" | "explanation", lang: "ar" | "en", text: string) => {
  (q as Record<string, unknown>)[`${key}${lang === "ar" ? "Ar" : "En"}`] = text;
};

// base64 without Buffer / btoa differences between Node and the browser
const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
export function bytesToBase64(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = bytes[i + 1];
    const c = bytes[i + 2];
    out += B64[a >> 2] + B64[((a & 3) << 4) | ((b ?? 0) >> 4)] + (b === undefined ? "=" : B64[((b & 15) << 2) | ((c ?? 0) >> 6)]) + (c === undefined ? "=" : B64[c & 63]);
  }
  return out;
}
export function base64ToBytes(s: string): Uint8Array {
  const clean = s.replace(/[^A-Za-z0-9+/]/g, "");
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const n = (B64.indexOf(clean[i]) << 18) | (B64.indexOf(clean[i + 1]) << 12) | ((B64.indexOf(clean[i + 2]) & 63) << 6) | (B64.indexOf(clean[i + 3]) & 63);
    out[o++] = (n >> 16) & 255;
    if (clean[i + 2] !== undefined && o < out.length) out[o++] = (n >> 8) & 255;
    if (clean[i + 3] !== undefined && o < out.length) out[o++] = n & 255;
  }
  return out.slice(0, o);
}

export const MIME_BY_EXT: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif", pdf: "application/pdf" };
export const mimeOf = (name: string) => MIME_BY_EXT[name.split(".").pop()?.toLowerCase() ?? ""] ?? "";
