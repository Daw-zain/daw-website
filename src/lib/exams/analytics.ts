"use client";

/** Reports and analytics (phase 12) — browser types. All numbers come from the exam_analytics_* database functions. */
import type { QuestionType } from "./bank";

export type Scope = "all" | "first" | "last" | "best";
export const SCOPES: Scope[] = ["all", "first", "last", "best"];
export type AnalyticsFilter = { examId: string; memberId: string; from: string; to: string; scope: Scope };
export const NO_ANALYTICS_FILTER: AnalyticsFilter = { examId: "", memberId: "", from: "", to: "", scope: "all" };

export type Breakdown = { key: string | null; nameAr: string | null; nameEn: string | null; questions: number; asked: number; answered: number; correct: number; scorePct: number | null };

export type QuestionStat = {
  questionId: string;
  stemAr: string;
  stemEn: string;
  type: QuestionType;
  difficulty: string;
  status: string;
  versions: number;
  domainAr: string | null;
  domainEn: string | null;
  asked: number;
  answered: number;
  correct: number;
  wrong: number;
  unanswered: number;
  facility: number | null;
  discrimination: number | null;
};

export type ExamStat = {
  examId: string;
  titleAr: string;
  titleEn: string;
  examType: string;
  passPercent: number;
  attempts: number;
  counted: number;
  learners: number;
  avgPercent: number | null;
  minPercent: number | null;
  maxPercent: number | null;
  passRate: number | null;
  avgMinutes: number | null;
  timedOut: number;
};

export type LearnerStat = {
  memberId: string;
  name: string;
  email: string;
  attempts: number;
  counted: number;
  exams: number;
  examsPassed: number;
  avgPercent: number | null;
  bestPercent: number | null;
  lastPercent: number | null;
  lastAt: string;
  warnings: number;
};

export type AttemptStat = {
  id: string;
  examId: string;
  titleAr: string;
  titleEn: string;
  name: string;
  email: string;
  attemptNo: number;
  status: string;
  needsManual: boolean;
  startedAt: string;
  submittedAt: string | null;
  minutes: number | null;
  score: number | null;
  maxScore: number | null;
  percent: number | null;
  passed: boolean | null;
  questions: number;
  answered: number;
  unanswered: number;
  flagged: number;
  correct: number;
  wrong: number;
  warnings: number;
  counted: boolean;
};

export type ImprovementRow = { memberId: string; name: string; email: string; examId: string; titleAr: string; titleEn: string; attempts: number; first: number; last: number; best: number; change: number };

export type CourseReport = {
  generatedAt: string;
  options: { exams: { id: string; titleAr: string; titleEn: string }[]; learners: { id: string; name: string; email: string }[] };
  summary: {
    attempts: number;
    counted: number;
    inProgress: number;
    pendingGrading: number;
    underReview: number;
    cancelled: number;
    learners: number;
    avgPercent: number | null;
    medianPercent: number | null;
    minPercent: number | null;
    maxPercent: number | null;
    passed: number;
    graded: number;
    passRate: number | null;
    avgMinutes: number | null;
  };
  distribution: { from: number; to: number; count: number }[];
  trend: { unit: "day" | "month"; points: { period: string; attempts: number; avgPercent: number | null; passRate: number | null }[] };
  domains: Breakdown[];
  topics: Breakdown[];
  types: Breakdown[];
  difficulties: Breakdown[];
  questions: QuestionStat[];
  exams: ExamStat[];
  improvement: { pairs: number; improved: number; declined: number; unchanged: number; avgFirst: number | null; avgLast: number | null; avgChange: number | null; rows: ImprovementRow[] };
  learners: LearnerStat[];
  attemptsList: AttemptStat[];
  mistakes: { total: number; learners: number; mastered: number; stillWrong: number; inProgress: number; wrongTotal: number; reviewCorrect: number; reviewWrong: number; sessions: number };
  security: {
    byKind: { kind: string; events: number; counted: number; attempts: number }[];
    attemptsWithWarnings: number;
    events: { at: string; kind: string; counted: boolean; detail: string; attemptId: string; name: string; email: string; titleAr: string; titleEn: string }[];
  };
};

export type QuestionAnalysis = {
  questionId: string;
  type: QuestionType;
  version: number | null;
  stemAr: string;
  stemEn: string;
  asked: number;
  results: { full: number; partial: number; zero: number; unanswered: number };
  options: { id: string; textAr?: string; textEn?: string; correct: boolean; count: number }[] | null;
  answers: { text: string; count: number; correct: boolean }[] | null;
};

export type MyReport = {
  summary: { attempts: number; released: number; waiting: number; avgPercent: number | null; bestPercent: number | null; passed: number; graded: number; exams: number; examsPassed: number };
  exams: {
    examId: string;
    titleAr: string;
    titleEn: string;
    programId: string;
    passPercent: number;
    first: number | null;
    last: number | null;
    best: number | null;
    passed: boolean;
    change: number | null;
    attempts: { id: string; attemptNo: number; percent: number | null; passed: boolean | null; at: string }[];
  }[];
  domains: Breakdown[];
  topics: Breakdown[];
  types: Breakdown[];
  difficulties: Breakdown[];
  mistakes: { total: number; mastered: number; stillWrong: number; reviewCorrect: number; reviewWrong: number };
};

/** Item-analysis warnings. Thresholds are shown to the user next to the table. */
export type QuestionFlag = "hard" | "easy" | "weak" | "negative";
export function questionFlags(q: Pick<QuestionStat, "asked" | "facility" | "discrimination">): QuestionFlag[] {
  const out: QuestionFlag[] = [];
  if (q.facility !== null && q.asked >= 5) {
    if (q.facility < 40) out.push("hard");
    else if (q.facility > 90) out.push("easy");
  }
  if (q.discrimination !== null) {
    if (q.discrimination < 0) out.push("negative");
    else if (q.discrimination < 0.15) out.push("weak");
  }
  return out;
}

export const pct = (v: number | null | undefined) => (v === null || v === undefined ? "—" : `${Math.round(v * 10) / 10}%`);
