"use client";

import { useMemo, useState } from "react";
import { stem, text, type Item, type QuestionFull } from "@/lib/exams/bank";
import type { ExamLabels } from "./ExamShell";

/** Stable "shuffle" for previews (learners get a real per-attempt shuffle from the server in phase 6) */
const shuffled = (list: Item[]) => [...list].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

/**
 * Learner-style rendering of a question (interactive, nothing is saved) + the answer key for staff.
 * The answer key is only ever shown inside the staff bank; the learner exam UI (phase 7) receives
 * questions from functions that never include it.
 */
export function QuestionPreview({ q, locale, labels, showKey = true }: { q: QuestionFull; locale: string; labels: ExamLabels; showKey?: boolean }) {
  const b = labels.bank;
  const e = b.editor;
  const ar = locale === "ar";
  const [pick, setPick] = useState<string[]>([]);
  const [order, setOrder] = useState<Item[]>(() => shuffled(q.content.items ?? []));
  const [pairs, setPairs] = useState<Record<string, string>>({});
  const [essay, setEssay] = useState("");
  const rightShuffled = useMemo(() => shuffled(q.content.right ?? []), [q.content.right]);
  const unit = ar ? q.content.unitAr || q.content.unitEn : q.content.unitEn || q.content.unitAr;
  const words = essay.trim() ? essay.trim().split(/\s+/).length : 0;

  const move = (i: number, d: -1 | 1) => {
    const n = [...order];
    const j = i + d;
    if (j < 0 || j >= n.length) return;
    [n[i], n[j]] = [n[j], n[i]];
    setOrder(n);
  };

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-line bg-white p-5">
        <p className="whitespace-pre-line text-[17px] font-semibold leading-8 text-navy">{stem(q, locale)}</p>

        <div className="mt-4">
          {(q.type === "MCQ" || q.type === "MULTI") && (
            <ul className="space-y-2">
              {(q.content.options ?? []).map((o) => {
                const on = pick.includes(o.id);
                return (
                  <li key={o.id}>
                    <label className={`flex cursor-pointer items-start gap-3 rounded-xl border px-4 py-3 transition ${on ? "border-brand bg-brand/5" : "border-line hover:border-brand/40"}`}>
                      <input
                        type={q.type === "MCQ" ? "radio" : "checkbox"}
                        name={`pv-${q.id}`}
                        checked={on}
                        onChange={() => setPick(q.type === "MCQ" ? [o.id] : on ? pick.filter((x) => x !== o.id) : [...pick, o.id])}
                        className="mt-1 h-4 w-4 accent-[var(--color-brand)]"
                      />
                      <span className="leading-7">{text(o, locale)}</span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}

          {q.type === "TRUE_FALSE" && (
            <div className="flex gap-3">
              {[
                ["t", e.tfTrue],
                ["f", e.tfFalse],
              ].map(([v, l]) => (
                <label key={v} className={`flex cursor-pointer items-center gap-2 rounded-xl border px-5 py-3 ${pick[0] === v ? "border-brand bg-brand/5" : "border-line"}`}>
                  <input type="radio" name={`pv-${q.id}`} checked={pick[0] === v} onChange={() => setPick([v])} className="h-4 w-4 accent-[var(--color-brand)]" />
                  {l}
                </label>
              ))}
            </div>
          )}

          {q.type === "NUMERIC" && (
            <div className="flex items-center gap-2">
              <input type="number" inputMode="decimal" className="field w-48" dir="ltr" />
              {unit && <span className="text-slate">{unit}</span>}
            </div>
          )}

          {q.type === "SHORT" && <input type="text" className="field max-w-md" />}

          {q.type === "ESSAY" && (
            <div>
              <textarea value={essay} onChange={(ev) => setEssay(ev.target.value)} rows={6} className="field" />
              <p className="mt-1 text-xs text-slate" dir="ltr">
                {words}
                {q.content.minWords != null || q.content.maxWords != null ? ` / ${q.content.minWords ?? 0}–${q.content.maxWords ?? "∞"}` : ""}
              </p>
            </div>
          )}

          {q.type === "ORDERING" && (
            <ol className="space-y-2">
              {order.map((it, i) => (
                <li key={it.id} className="flex items-center gap-3 rounded-xl border border-line px-4 py-2.5">
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-mist text-sm font-bold text-navy">{i + 1}</span>
                  <span className="flex-1 leading-7">{text(it, locale)}</span>
                  <button type="button" onClick={() => move(i, -1)} className="rounded-lg px-2 py-1 text-slate hover:bg-mist" aria-label={e.up}>
                    ↑
                  </button>
                  <button type="button" onClick={() => move(i, 1)} className="rounded-lg px-2 py-1 text-slate hover:bg-mist" aria-label={e.down}>
                    ↓
                  </button>
                </li>
              ))}
            </ol>
          )}

          {q.type === "MATCHING" && (
            <ul className="space-y-2">
              {(q.content.left ?? []).map((l) => (
                <li key={l.id} className="grid items-center gap-2 rounded-xl border border-line px-4 py-2.5 sm:grid-cols-2">
                  <span className="leading-7">{text(l, locale)}</span>
                  <select value={pairs[l.id] ?? ""} onChange={(ev) => setPairs({ ...pairs, [l.id]: ev.target.value })} className="field">
                    <option value="">—</option>
                    {rightShuffled.map((r) => (
                      <option key={r.id} value={r.id}>
                        {text(r, locale)}
                      </option>
                    ))}
                  </select>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {showKey && <AnswerKey q={q} locale={locale} labels={labels} />}
    </div>
  );
}

function AnswerKey({ q, locale, labels }: { q: QuestionFull; locale: string; labels: ExamLabels }) {
  const e = labels.bank.editor;
  const ar = locale === "ar";
  const byId = (list: Item[] | undefined, id: string) => list?.find((x) => x.id === id);
  const feedback = ar ? q.feedbackAr || q.feedbackEn : q.feedbackEn || q.feedbackAr;
  const explanation = ar ? q.explanationAr || q.explanationEn : q.explanationEn || q.explanationAr;
  const rubric = ar ? q.answer.rubricAr || q.answer.rubricEn : q.answer.rubricEn || q.answer.rubricAr;
  const rationales = Object.entries(q.optionRationale ?? {}).filter(([, v]) => (ar ? v.ar || v.en : v.en || v.ar));

  return (
    <div className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-5 text-sm leading-7">
      <p className="font-bold text-emerald-800">{e.answerKey}</p>
      <div className="mt-2 text-ink">
        {(q.type === "MCQ" || q.type === "MULTI") && (
          <ul className="list-inside list-disc">
            {(q.answer.correct ?? []).map((id) => (
              <li key={id}>{byId(q.content.options, id) ? text(byId(q.content.options, id)!, locale) : id}</li>
            ))}
          </ul>
        )}
        {q.type === "TRUE_FALSE" && <p>{q.answer.value === true ? e.tfTrue : q.answer.value === false ? e.tfFalse : "—"}</p>}
        {q.type === "NUMERIC" && (
          <p dir="ltr" className={ar ? "text-end" : ""}>
            {String(q.answer.value ?? "—")} ± {String(q.answer.tolerance ?? 0)}
          </p>
        )}
        {q.type === "SHORT" && <p>{(q.answer.accepted ?? []).join(" · ")}</p>}
        {q.type === "ESSAY" && <p className="whitespace-pre-line">{rubric || "—"}</p>}
        {q.type === "ORDERING" && (
          <ol className="list-inside list-decimal">
            {(q.content.items ?? []).map((it) => (
              <li key={it.id}>{text(it, locale)}</li>
            ))}
          </ol>
        )}
        {q.type === "MATCHING" && (
          <ul className="space-y-1">
            {(q.content.left ?? []).map((l) => {
              const r = byId(q.content.right, q.answer.pairs?.[l.id] ?? "");
              return (
                <li key={l.id}>
                  {text(l, locale)} ⟵ {r ? text(r, locale) : "—"}
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {rationales.length > 0 && (
        <div className="mt-3 border-t border-emerald-200 pt-3">
          <p className="font-semibold text-emerald-800">{e.rationale}</p>
          <ul className="mt-1 space-y-1">
            {rationales.map(([id, v]) => {
              const o = byId(q.content.options, id);
              return (
                <li key={id}>
                  <span className="font-semibold">{o ? text(o, locale) : id}:</span> {ar ? v.ar || v.en : v.en || v.ar}
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {feedback && (
        <div className="mt-3 border-t border-emerald-200 pt-3">
          <p className="font-semibold text-emerald-800">{e.feedback}</p>
          <p className="whitespace-pre-line">{feedback}</p>
        </div>
      )}
      {explanation && (
        <div className="mt-3 border-t border-emerald-200 pt-3">
          <p className="font-semibold text-emerald-800">{e.explanation}</p>
          <p className="whitespace-pre-line">{explanation}</p>
        </div>
      )}
      {q.reference && (
        <p className="mt-3 border-t border-emerald-200 pt-3 text-slate">
          <span className="font-semibold">{e.reference}:</span> {q.reference}
        </p>
      )}
    </div>
  );
}
