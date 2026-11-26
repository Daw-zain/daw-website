"use client";

import { useEffect, useState } from "react";
import { rpc } from "@/lib/exams/client";
import { Notice, type ExamLabels } from "./ExamShell";

/** Admin: Mistakes Quiz mastery policy (consecutive correct review sessions, 1–5). Checked again in the database. */
export function MasteryPolicy({ labels }: { labels: ExamLabels }) {
  const mk = labels.mistakes;
  const [value, setValue] = useState<number | null>(null);
  const [msg, setMsg] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    rpc<{ masteryStreak: number }>("exam_mistakes_overview", { p_program: null, p_filter: {} }).then((r) => setValue(r.masteryStreak)).catch(() => setValue(2));
  }, []);
  const save = async () => {
    setBusy(true);
    setMsg(null);
    try {
      await rpc("exam_admin_set_mastery", { p_streak: value });
      setMsg({ tone: "success", text: mk.policySaved });
    } catch {
      setMsg({ tone: "error", text: labels.errorGeneric });
    }
    setBusy(false);
  };
  if (value === null) return null;
  return (
    <section className="mt-12">
      <div className="card max-w-xl space-y-3 p-5">
        <h2 className="text-lg font-bold text-navy">{mk.policyTitle}</h2>
        <p className="text-sm text-slate">{mk.policyHint}</p>
        <div className="flex items-center gap-3">
          <select aria-label={mk.policyTitle} className="rounded-lg border border-line bg-white px-3 py-2 text-sm" value={value} onChange={(e) => setValue(Number(e.target.value))}>
            {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
          <button type="button" disabled={busy} onClick={save} className="btn btn-primary btn-sm">{mk.save}</button>
        </div>
        <p className="text-xs text-slate">{mk.masteryRule.replace("{n}", String(value))}</p>
        {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      </div>
    </section>
  );
}
