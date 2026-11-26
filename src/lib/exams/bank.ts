"use client";

/** Question bank (phase 3) — browser types and helpers. All reads/writes go through exam_bank_* functions. */
import { ExamError } from "./client";

export const QUESTION_TYPES = ["MCQ", "MULTI", "TRUE_FALSE", "NUMERIC", "SHORT", "ESSAY", "ORDERING", "MATCHING", "HOTSPOT", "DRAGDROP", "CLOZE"] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];
export type QStatus = "DRAFT" | "ACTIVE" | "DISABLED";
export type Difficulty = "EASY" | "MEDIUM" | "HARD";
export type CategoryKind = "DOMAIN" | "TOPIC" | "SUBTOPIC";
export type ScoringMode = "ALL_OR_NOTHING" | "PARTIAL" | "PARTIAL_PENALTY";

export type Item = { id: string; textAr: string; textEn: string };

export type Category = { id: string; parentId: string | null; kind: CategoryKind; nameAr: string; nameEn: string; sortOrder: number; active: boolean; questions: number };

export type BankOverview = {
  categories: Category[];
  counts: { total: number; scenarios: number; byStatus: Partial<Record<QStatus, number>>; byType: Partial<Record<QuestionType, number>> };
  can: { edit: boolean; delete: boolean; categories: boolean; scenarios: boolean; import: boolean; export: boolean };
};

// ── phase 4: scenarios + attachments ──
export const SCENARIO_PARTS = ["project", "events", "constraints", "risks", "stakeholders", "info"] as const;
export type ScenarioPart = (typeof SCENARIO_PARTS)[number];
export type ScenarioTable = { captionAr: string; captionEn: string; rows: string[][] };
export type ScenarioSummary = { id: string; titleAr: string; titleEn: string; status: QStatus; displayMode: "SIDE" | "SECTION"; version: number; questions: number; assets: number; updatedAt: string };
export type ScenarioFull = {
  id: string;
  titleAr: string;
  titleEn: string;
  bodyAr: string;
  bodyEn: string;
  details: Partial<Record<ScenarioPart, { ar: string; en: string }>>;
  tables: ScenarioTable[];
  displayMode: "SIDE" | "SECTION";
  status: QStatus;
  version: number;
  questions?: { id: string; type: QuestionType; status: QStatus; stemAr: string; stemEn: string; points: number; scenarioOrder: number; version: number }[];
};
export const blankScenario = (): ScenarioFull => ({ id: "", titleAr: "", titleEn: "", bodyAr: "", bodyEn: "", details: {}, tables: [], displayMode: "SIDE", status: "DRAFT", version: 0 });

export type OwnerType = "QUESTION" | "SCENARIO";
export type ExamAsset = { id: string; ownerType: OwnerType; ownerId: string; kind: "IMAGE" | "FILE"; path: string; mime: string; size: number; fileName: string; captionAr: string; captionEn: string; sortOrder: number };
export const ASSET_BUCKET = "exam-assets";
export const ASSET_TYPES: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif", "application/pdf": "pdf" };
export const ASSET_MAX = 10 * 1024 * 1024;

export type QuestionSummary = {
  id: string;
  type: QuestionType;
  status: QStatus;
  stemAr: string;
  stemEn: string;
  difficulty: Difficulty;
  points: number;
  weight: number;
  domainId: string | null;
  topicId: string | null;
  subtopicId: string | null;
  version: number;
  updatedAt: string;
  scenarioId?: string | null;
};

// ── phase 10: advanced types + graphic-based questions ──
/** hotspot area in % of the image (x, y = top-left corner) */
export type Region = { id: string; x: number; y: number; w: number; h: number };
export type ClozeBlank = { id: string; kind: "SELECT" | "TEXT"; options?: Item[] };
export const FIGURE_KINDS = ["TABLE", "BAR", "LINE", "PIE"] as const;
export type FigureKind = (typeof FIGURE_KINDS)[number];
/** a table or chart attached to any question; rows[0] = header, charts: column 1 = labels, other columns = numbers */
export type Figure = { kind: FigureKind; captionAr: string; captionEn: string; rows: string[][] };

export type QuestionContent = {
  options?: Item[];
  zones?: Item[];
  textAr?: string;
  textEn?: string;
  blanks?: ClozeBlank[];
  figure?: Figure;
  items?: Item[];
  left?: Item[];
  right?: Item[];
  unitAr?: string;
  unitEn?: string;
  minWords?: number;
  maxWords?: number;
};

export type QuestionAnswer = {
  correct?: string[];
  value?: boolean | number;
  tolerance?: number;
  accepted?: string[];
  caseSensitive?: boolean;
  rubricAr?: string;
  rubricEn?: string;
  order?: string[];
  pairs?: Record<string, string>;
  regions?: Region[];
  placements?: Record<string, string>;
  blanks?: Record<string, { correct?: string; accepted?: string[]; caseSensitive?: boolean }>;
};

export type QuestionFull = Omit<QuestionSummary, "updatedAt"> & {
  programId?: string;
  content: QuestionContent;
  answer: QuestionAnswer;
  scoring: { mode?: ScoringMode | "MANUAL" };
  keywords: string[];
  reference: string;
  feedbackAr: string;
  feedbackEn: string;
  explanationAr: string;
  explanationEn: string;
  optionRationale: Record<string, { ar?: string; en?: string }>;
  updatedAt?: string;
  scenarioId: string | null;
  scenarioOrder?: number;
};

export const newItemId = () => Math.random().toString(36).slice(2, 10);
const items = (n: number): Item[] => Array.from({ length: n }, () => ({ id: newItemId(), textAr: "", textEn: "" }));

/** Empty question of a type, ready for the editor */
export function blankQuestion(type: QuestionType): QuestionFull {
  const base = {
    id: "",
    type,
    status: "DRAFT" as QStatus,
    stemAr: "",
    stemEn: "",
    difficulty: "MEDIUM" as Difficulty,
    points: 1,
    weight: 1,
    domainId: null,
    topicId: null,
    subtopicId: null,
    version: 0,
    keywords: [],
    reference: "",
    feedbackAr: "",
    feedbackEn: "",
    explanationAr: "",
    explanationEn: "",
    optionRationale: {},
    scenarioId: null,
    scoring: { mode: "ALL_OR_NOTHING" as ScoringMode },
  };
  switch (type) {
    case "MCQ":
    case "MULTI":
      return { ...base, content: { options: items(4) }, answer: { correct: [] } };
    case "TRUE_FALSE":
      return { ...base, content: {}, answer: {} };
    case "NUMERIC":
      return { ...base, content: { unitAr: "", unitEn: "" }, answer: { tolerance: 0 } };
    case "SHORT":
      return { ...base, content: {}, answer: { accepted: [], caseSensitive: false } };
    case "ESSAY":
      return { ...base, content: {}, answer: { rubricAr: "", rubricEn: "" }, scoring: { mode: "MANUAL" } };
    case "ORDERING":
      return { ...base, content: { items: items(3) }, answer: {} };
    case "MATCHING":
      return { ...base, content: { left: items(3), right: items(3) }, answer: { pairs: {} } };
    case "HOTSPOT":
      return { ...base, content: {}, answer: { regions: [] } };
    case "DRAGDROP":
      return { ...base, content: { items: items(3), zones: items(2) }, answer: { placements: {} } };
    case "CLOZE":
      return { ...base, content: { textAr: "", textEn: "", blanks: [] }, answer: { blanks: {} } };
  }
}

/** Fill derived answer parts before saving (ordering = items as entered) */
export function toSavePayload(q: QuestionFull) {
  const answer = { ...q.answer };
  if (q.type === "ORDERING") answer.order = (q.content.items ?? []).map((i) => i.id);
  return {
    id: q.id || undefined,
    type: q.type,
    status: q.status,
    stemAr: q.stemAr,
    stemEn: q.stemEn,
    content: q.content,
    answer,
    scoring: q.scoring,
    points: String(q.points),
    weight: String(q.weight),
    difficulty: q.difficulty,
    domainId: q.domainId,
    topicId: q.topicId,
    subtopicId: q.subtopicId,
    keywords: q.keywords,
    reference: q.reference,
    feedbackAr: q.feedbackAr,
    feedbackEn: q.feedbackEn,
    explanationAr: q.explanationAr,
    explanationEn: q.explanationEn,
    optionRationale: q.optionRationale,
    scenarioId: q.scenarioId,
  };
}

/** Database error → message key in labels.bank.errors (e.g. "invalid_question: options_min_2" → options_min_2) */
export function bankErrorKey(e: unknown): string {
  const msg = e instanceof ExamError ? e.message : String((e as Error)?.message ?? e);
  const m = msg.match(/invalid_(?:question|category|scenario|asset): ([a-z_0-9]+)/);
  if (m) {
    const key = m[1];
    if (/^right_min/.test(key)) return "right_min";
    return key;
  }
  for (const k of ["category_in_use", "scenario_in_use", "question_in_exam", "question_in_attempt", "forbidden", "not_found"]) if (msg.includes(k)) return k;
  return "unknown";
}

export const text = (i: { textAr: string; textEn: string }, locale: string) => (locale === "ar" ? i.textAr || i.textEn : i.textEn || i.textAr);
export const stem = (q: { stemAr: string; stemEn: string }, locale: string) => (locale === "ar" ? q.stemAr || q.stemEn : q.stemEn || q.stemAr);
export const catName = (c: { nameAr: string; nameEn: string }, locale: string) => (locale === "ar" ? c.nameAr || c.nameEn : c.nameEn || c.nameAr);
export const title = (s: { titleAr: string; titleEn: string }, locale: string) => (locale === "ar" ? s.titleAr || s.titleEn : s.titleEn || s.titleAr);
export const pick = (v: { ar?: string; en?: string } | undefined, locale: string) => (locale === "ar" ? v?.ar || v?.en || "" : v?.en || v?.ar || "");
