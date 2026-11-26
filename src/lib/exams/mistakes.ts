"use client";

/** Mistakes Quiz (phase 9) — browser types. All data comes from the exam_mistakes_* database functions. */
import type { AttemptScenario, PublicQuestion, Response, ReviewQuestion } from "./attempt";
import type { QuestionType } from "./bank";

export const MISTAKE_STATUSES = ["WRONG_NOT_REVIEWED", "REVIEWED", "CORRECT_IN_REVIEW", "WRONG_AGAIN", "MASTERED"] as const;
export type MistakeStatus = (typeof MISTAKE_STATUSES)[number];

export type MistakeSummary = {
  id: string;
  programId: string;
  questionId: string;
  type: QuestionType;
  stemAr: string;
  stemEn: string;
  difficulty: string | null;
  domainId: string | null;
  topicId: string | null;
  domain: string | null;
  topic: string | null;
  status: MistakeStatus;
  wrongCount: number;
  reviewCorrect: number;
  reviewWrong: number;
  correctStreak: number;
  firstWrongAt: string;
  lastWrongAt: string;
  lastReviewedAt: string | null;
  masteredAt: string | null;
};

export type MistakesOverview = {
  masteryStreak: number;
  counts: { total: number; notReviewed: number; reviewed: number; correctInReview: number; wrongAgain: number; mastered: number; wrongTotal: number; reviewCorrect: number; reviewWrong: number };
  items: MistakeSummary[];
  byDomain: { domainId: string | null; name: string | null; total: number; mastered: number }[];
  openSession: string | null;
};

/** what the source exam's review policy allows to be shown */
export type Reveal = Pick<ReviewQuestion, "answer" | "feedbackAr" | "feedbackEn" | "explanationAr" | "explanationEn" | "optionRationale" | "reference">;

export type MistakeDetail = MistakeSummary & {
  data: PublicQuestion;
  scenario: AttemptScenario | null;
  lastResponse: Response;
  reveal: Reveal;
  history: { kind: string; at: string }[];
};

export type SessionQuestion = { id: string; position: number; data: PublicQuestion & { scenario?: AttemptScenario | null }; response: Response; isCorrect: boolean | null; reveal: Reveal | null };
export type MistakeSession = {
  id: string;
  programId: string;
  status: "IN_PROGRESS" | "COMPLETED";
  feedbackMode: "AFTER_ANSWER" | "AFTER_SESSION";
  serverNow: string;
  deadlineAt: string | null;
  questionCount: number;
  correctCount: number;
  score: number | null;
  maxScore: number | null;
  questions: SessionQuestion[];
};

export type MistakesReport = {
  masteryStreak: number;
  learners: { memberId: string; name: string; email: string; total: number; mastered: number; stillWrong: number; wrongTotal: number; reviewCorrect: number; reviewWrong: number }[];
  questions: { questionId: string; stemAr: string; stemEn: string; type: QuestionType; learners: number; wrongs: number; mastered: number; domain: string | null }[];
  domains: { domainId: string | null; name: string | null; items: number; wrongs: number; mastered: number }[];
  topics: { topicId: string; name: string | null; items: number; wrongs: number }[];
  exams: { examId: string | null; title: string | null; items: number }[];
};
