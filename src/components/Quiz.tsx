"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { ProgressBar } from "./motion";
import { cn } from "@/lib/utils";

export type QuizQuestion = { q: string; options: string[]; answer: number; explain?: string };

export function Quiz({ questions, labels }: { questions: QuizQuestion[]; labels: { check: string; score: string; retry: string; correct: string; incorrect: string } }) {
  const [answers, setAnswers] = useState<(number | null)[]>(() => questions.map(() => null));
  const [checked, setChecked] = useState(false);
  const score = answers.filter((a, i) => a === questions[i].answer).length;
  const done = answers.every((a) => a !== null);

  return (
    <div className="space-y-6">
      {questions.map((q, qi) => (
        <fieldset key={qi} className="card p-6">
          <legend className="sr-only">{q.q}</legend>
          <p className="font-semibold text-navy">
            <span className="me-2 text-brand" dir="ltr">
              {qi + 1}.
            </span>
            {q.q}
          </p>
          <div className="mt-4 grid gap-2">
            {q.options.map((o, oi) => {
              const selected = answers[qi] === oi;
              const isCorrect = q.answer === oi;
              return (
                <label
                  key={oi}
                  className={cn(
                    "flex cursor-pointer items-center gap-3 rounded-xl border px-4 py-3 transition",
                    !checked && (selected ? "border-brand bg-sky-50" : "border-line hover:border-brand/40 hover:bg-mist"),
                    checked && isCorrect && "border-emerald-400 bg-emerald-50",
                    checked && selected && !isCorrect && "border-rose-300 bg-rose-50",
                    checked && !selected && !isCorrect && "border-line opacity-70",
                  )}
                >
                  <input
                    type="radio"
                    name={`q${qi}`}
                    className="h-4 w-4 accent-brand"
                    checked={selected}
                    disabled={checked}
                    onChange={() => setAnswers((a) => a.map((v, i) => (i === qi ? oi : v)))}
                  />
                  <span>{o}</span>
                </label>
              );
            })}
          </div>
          {checked && (
            <motion.p initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} className={cn("mt-4 text-sm", answers[qi] === q.answer ? "text-emerald-700" : "text-rose-700")}>
              <strong>{answers[qi] === q.answer ? labels.correct : labels.incorrect}.</strong> {q.explain}
            </motion.p>
          )}
        </fieldset>
      ))}
      {checked ? (
        <div className="card p-6" role="status">
          <p className="text-lg font-bold text-navy">
            {labels.score}:{" "}
            <span dir="ltr">
              {score} / {questions.length}
            </span>
          </p>
          <div className="mt-3">
            <ProgressBar value={(score / questions.length) * 100} label={labels.score} />
          </div>
          <button
            type="button"
            className="btn btn-outline mt-5"
            onClick={() => {
              setAnswers(questions.map(() => null));
              setChecked(false);
            }}
          >
            {labels.retry}
          </button>
        </div>
      ) : (
        <button type="button" className="btn btn-primary" disabled={!done} onClick={() => setChecked(true)}>
          {labels.check}
        </button>
      )}
    </div>
  );
}
