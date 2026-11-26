"use client";

/** Attempts (phase 6) — browser types. The browser only ever holds public question data; grading is on the server. */
import type { ClozeBlank, Figure, Item, QuestionType, Region, ScenarioFull } from "./bank";

export type AttemptStatus = "IN_PROGRESS" | "SUBMITTED" | "COMPLETED" | "TIMED_OUT" | "ABANDONED" | "UNDER_REVIEW" | "CANCELLED";
export type AssetRef = { path: string; kind: "IMAGE" | "FILE"; captionAr: string; captionEn: string };

/** What the learner sees of a question (no answer) */
export type PublicQuestion = {
  type: QuestionType;
  stemAr: string;
  stemEn: string;
  images: AssetRef[];
  scenarioId?: string | null;
  options?: Item[];
  selectCount?: number;
  unitAr?: string;
  unitEn?: string;
  minWords?: number | null;
  maxWords?: number | null;
  items?: Item[];
  left?: Item[];
  right?: Item[];
  // phase 10
  hotspot?: AssetRef | null;
  zones?: Item[];
  textAr?: string;
  textEn?: string;
  blanks?: ClozeBlank[];
  figure?: Figure;
};

export type Mark = { x: number; y: number };

export type Response = { choice?: string; choices?: string[]; value?: boolean | number; text?: string; order?: string[]; pairs?: Record<string, string>; points?: Mark[]; place?: Record<string, string>; blanks?: Record<string, string> } | null;

export type AttemptQuestionState = { id: string; position: number; points: number; data: PublicQuestion; response: Response; flagged: boolean };
export type AttemptScenario = Omit<ScenarioFull, "status" | "version" | "questions" | "id"> & { id: string; images: AssetRef[] };

export type AttemptState = {
  id: string;
  examId: string;
  attemptNo: number;
  status: AttemptStatus;
  titleAr: string;
  titleEn: string;
  serverNow: string;
  deadlineAt: string | null;
  graceSeconds: number;
  tools: { calculator: boolean; whiteboard: boolean; translation: boolean };
  security: { fullscreen?: boolean; detectBlur?: boolean; maxWarnings?: number; onExceed?: string; watermark?: boolean; blockCopy?: boolean };
  watermark: string;
  scenarios: Record<string, AttemptScenario>;
  questions: AttemptQuestionState[];
};

export type TakeInfo = {
  id: string;
  programId: string;
  folderId: string;
  titleAr: string;
  titleEn: string;
  descAr: string;
  descEn: string;
  examType: "PRACTICE" | "SIMULATION" | "FINAL";
  durationMinutes: number | null;
  startsAt: string | null;
  endsAt: string | null;
  passPercent: number;
  questionCount: number;
  tools: { calculator: boolean; whiteboard: boolean; translation: boolean };
  security: { fullscreen?: boolean };
  attemptsUsed: number;
  attemptsAllowed: number | null;
  canStart: boolean;
  reason: string | null;
  openAttemptId: string | null;
  attempts: { id: string; attemptNo: number; status: AttemptStatus; startedAt: string; submittedAt: string | null; resultsVisible: boolean; reviewVisible: boolean; score: number | null; maxScore: number | null; percent: number | null; passed: boolean | null; needsManual: boolean }[];
};

export type ReviewQuestion = {
  id: string;
  position: number;
  points: number;
  data: PublicQuestion;
  response: Response;
  score: number | null;
  isCorrect: boolean | null;
  graderComment: string;
  answer?: { correct?: string[]; value?: boolean | number; tolerance?: number; accepted?: string[]; order?: string[]; pairs?: Record<string, string>; rubricAr?: string; regions?: Region[]; placements?: Record<string, string>; blanks?: Record<string, { correct?: string; accepted?: string[] }> } | null;
  feedbackAr?: string | null;
  feedbackEn?: string | null;
  explanationAr?: string | null;
  explanationEn?: string | null;
  optionRationale?: Record<string, { ar?: string; en?: string }> | null;
  reference?: string | null;
};

export type AttemptReview = {
  id: string;
  examId: string;
  attemptNo: number;
  status: AttemptStatus;
  titleAr: string;
  titleEn: string;
  startedAt: string;
  submittedAt: string | null;
  questionCount: number;
  answeredCount: number;
  resultsVisible: boolean;
  reviewVisible: boolean;
  needsManual: boolean;
  score: number | null;
  maxScore: number | null;
  percent: number | null;
  passed: boolean | null;
  passPercent: number;
  correctCount: number | null;
  wrongCount: number | null;
  scenarios: Record<string, AttemptScenario>;
  questions: ReviewQuestion[];
};

export const isAnswered = (r: Response) =>
  !!r && ((r.choice ?? "") !== "" || (r.choices?.length ?? 0) > 0 || typeof r.value === "boolean" || typeof r.value === "number" || (r.text ?? "").trim() !== "" || (r.order?.length ?? 0) > 0 || Object.keys(r.pairs ?? {}).length > 0 || (r.points?.length ?? 0) > 0 || Object.keys(r.place ?? {}).length > 0 || Object.values(r.blanks ?? {}).some((v) => (v ?? "").trim() !== ""));

export const fmtClock = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const p = (n: number) => String(n).padStart(2, "0");
  return h ? `${h}:${p(m)}:${p(sec)}` : `${p(m)}:${p(sec)}`;
};

export const txt = (o: { textAr?: string; textEn?: string } | undefined, locale: string) => (o ? (locale === "ar" ? o.textAr || o.textEn : o.textEn || o.textAr) ?? "" : "");
