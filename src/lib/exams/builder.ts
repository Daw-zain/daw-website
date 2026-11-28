"use client";

/** Exam builder (phase 5) — browser types and helpers. Everything is validated again by exam_exam_* functions. */
import { ExamError, utcDate } from "./client";
import type { Difficulty, QuestionType, QStatus } from "./bank";

export type ExamStatus = "DRAFT" | "PENDING_APPROVAL" | "PUBLISHED" | "STOPPED" | "ARCHIVED";
export type ExamType = "PRACTICE" | "SIMULATION" | "FINAL";
export type Security = { fullscreen: boolean; detectBlur: boolean; maxWarnings: number; onExceed: "WARN" | "SUBMIT" | "REVIEW"; watermark: boolean; blockCopy: boolean };

export type ExamItemRow = {
  questionId: string;
  points: string | number | null;
  weight: string | number | null;
  // read-only info returned by the server
  type?: QuestionType;
  status?: QStatus;
  stemAr?: string;
  stemEn?: string;
  qPoints?: number;
  qWeight?: number;
  scenarioId?: string | null;
};
export type ExamRuleRow = {
  count: number | string;
  domainId: string | null;
  topicId: string | null;
  subtopicId: string | null;
  difficulty: Difficulty | null;
  qtype: QuestionType | null;
  scenarios: boolean;
  points: string | number | null;
  weight: string | number | null;
};
export type CheckIssue = { code: string; n?: number; position?: number; need?: number; available?: number };
export type ExamCheck = { ok: boolean; issues: CheckIssue[]; rules: { position: number; count: number; available: number; scenarios: boolean }[]; questionCount: number; fixedPoints: number; variablePoints: boolean };

export type ExamFull = {
  id: string;
  programId: string;
  folderId: string;
  folderKind?: string;
  titleAr: string;
  titleEn: string;
  descAr: string;
  descEn: string;
  examType: ExamType;
  durationMinutes: number | null;
  graceSeconds: number;
  startsAt: string | null;
  endsAt: string | null;
  maxAttempts: number | null;
  shuffleQuestions: boolean;
  shuffleOptions: boolean;
  passPercent: number | string;
  reviewPolicy: "NEVER" | "AFTER_SUBMIT" | "AFTER_CLOSE";
  resultsPolicy: "IMMEDIATE" | "AFTER_CLOSE" | "MANUAL";
  showFeedback: boolean;
  showExplanation: boolean;
  showCorrect: boolean;
  allowCalculator: boolean;
  allowWhiteboard: boolean;
  allowTranslation: boolean;
  /** saved on its own (exam_seb_set_exam), not by the exam form */
  requireSeb?: boolean;
  resumePolicy: "RESUME" | "NO_RESUME";
  security: Security;
  status: ExamStatus;
  reviewNote: string;
  version: number;
  items: ExamItemRow[];
  rules: ExamRuleRow[];
  check?: ExamCheck;
  canEdit?: boolean;
  canPublish?: boolean;
  canApprove?: boolean;
};

export type FolderExamSummary = {
  id: string;
  titleAr: string;
  titleEn: string;
  descAr: string;
  descEn: string;
  examType: ExamType;
  status: ExamStatus;
  durationMinutes: number | null;
  maxAttempts: number | null;
  startsAt: string | null;
  endsAt: string | null;
  passPercent: number;
  questionCount: number;
  updatedAt: string;
};
/** a folder: its sub-folders (one level), the folder it sits in, and its own exams */
export type SubFolder = { id: string; nameAr: string; nameEn: string; status: string; count: number };
export type FolderExams = { folder: { id: string; kind: string; nameAr: string; nameEn: string; programId: string }; parent?: { id: string; nameAr: string; nameEn: string } | null; folders?: SubFolder[]; canEdit: boolean; canApprove: boolean; exams: FolderExamSummary[] };

export function blankExam(folderId: string, kind?: string): ExamFull {
  const sim = kind === "EXAM_SIMULATIONS";
  return {
    id: "",
    programId: "",
    folderId,
    folderKind: kind,
    titleAr: "",
    titleEn: "",
    descAr: "",
    descEn: "",
    examType: sim ? "SIMULATION" : "PRACTICE",
    durationMinutes: sim ? 230 : 30,
    graceSeconds: 0,
    startsAt: null,
    endsAt: null,
    maxAttempts: sim ? 3 : null,
    shuffleQuestions: true,
    shuffleOptions: true,
    passPercent: 70,
    reviewPolicy: "AFTER_SUBMIT",
    resultsPolicy: "IMMEDIATE",
    showFeedback: true,
    showExplanation: true,
    showCorrect: true,
    allowCalculator: sim,
    allowWhiteboard: sim,
    allowTranslation: true,
    resumePolicy: "RESUME",
    security: { fullscreen: sim, detectBlur: true, maxWarnings: 3, onExceed: sim ? "REVIEW" : "WARN", watermark: true, blockCopy: true },
    status: "DRAFT",
    reviewNote: "",
    version: 0,
    items: [],
    rules: [],
  };
}

export const blankRule = (): ExamRuleRow => ({ count: 5, domainId: null, topicId: null, subtopicId: null, difficulty: null, qtype: null, scenarios: false, points: null, weight: null });

/** ISO ↔ <input type="datetime-local"> (local time, minutes) */
export const toLocalInput = (iso: string | null) => {
  const d = utcDate(iso);
  if (!d) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
export const fromLocalInput = (v: string) => (v ? new Date(v).toISOString() : null);

export function toSaveExam(e: ExamFull) {
  const s = (v: string | number | null | undefined) => (v === null || v === undefined || v === "" ? "" : String(v));
  return {
    id: e.id || undefined,
    folderId: e.folderId,
    titleAr: e.titleAr,
    titleEn: e.titleEn,
    descAr: e.descAr,
    descEn: e.descEn,
    examType: e.examType,
    durationMinutes: s(e.durationMinutes),
    graceSeconds: s(e.graceSeconds),
    startsAt: e.startsAt ?? "",
    endsAt: e.endsAt ?? "",
    maxAttempts: s(e.maxAttempts),
    shuffleQuestions: e.shuffleQuestions,
    shuffleOptions: e.shuffleOptions,
    passPercent: s(e.passPercent),
    reviewPolicy: e.reviewPolicy,
    resultsPolicy: e.resultsPolicy,
    showFeedback: e.showFeedback,
    showExplanation: e.showExplanation,
    showCorrect: e.showCorrect,
    allowCalculator: e.allowCalculator,
    allowWhiteboard: e.allowWhiteboard,
    allowTranslation: e.allowTranslation,
    resumePolicy: e.resumePolicy,
    security: e.security,
    items: e.items.map((i) => ({ questionId: i.questionId, points: s(i.points), weight: s(i.weight) })),
    rules: e.rules.map((r) => ({ ...r, count: s(r.count), points: s(r.points), weight: s(r.weight), domainId: r.domainId ?? "", topicId: r.topicId ?? "", subtopicId: r.subtopicId ?? "", difficulty: r.difficulty ?? "", qtype: r.qtype ?? "" })),
  };
}

/** server error → key in labels.builder.errors */
export function examErrorKey(e: unknown) {
  const msg = e instanceof ExamError ? e.message : String((e as Error)?.message ?? e);
  const m = msg.match(/invalid_exam: ([a-z_0-9]+)/);
  if (m) return m[1];
  for (const k of ["exam_locked", "exam_not_ready", "forbidden"]) if (msg.includes(k)) return k;
  return "unknown";
}

export function issueText(i: CheckIssue, templates: Record<string, string>) {
  const t = templates[i.code] ?? i.code;
  return t.replace("{n}", String(i.n ?? "")).replace("{position}", String(i.position ?? "")).replace("{need}", String(i.need ?? "")).replace("{available}", String(i.available ?? ""));
}
