"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { rpc, utcDate } from "@/lib/exams/client";
import { cn } from "@/lib/utils";
import { Spinner, type ExamLabels } from "./ExamShell";

type LogData = {
  events: { at: string; action: string; entity: string | null; entityId: string | null; programId: string | null; details: Record<string, unknown> | null; actor: string | null; course: string | null }[];
  attempts: { attemptId: string; examId: string; warnings: number; status: string; reviewFlag: boolean; email: string; name: string; startedAt: string; exam: string; course: string }[];
};

/** Protection log (phase 8): security.* audit entries + attempts with warnings. Scope enforced in the database. */
export function SecurityLog({ locale, labels }: { locale: string; labels: ExamLabels }) {
  const pr = labels.proctor;
  const [data, setData] = useState<LogData | null>(null);
  const [failed, setFailed] = useState(false);
  const fmt = (d: string) => utcDate(d)!.toLocaleString(locale === "ar" ? "ar-LY" : "en-GB", { dateStyle: "short", timeStyle: "short" });

  useEffect(() => {
    rpc<LogData>("exam_security_log", { p_limit: 100 }).then(setData).catch(() => setFailed(true));
  }, []);
  if (failed) return null;

  return (
    <section className="mt-12 space-y-4">
      <div>
        <h2 className="text-2xl font-bold">{pr.logTitle}</h2>
        <p className="mt-1 text-sm text-slate">{pr.logIntro}</p>
      </div>
      {!data ? <Spinner /> : (
        <div className="grid gap-5 lg:grid-cols-2">
          <div className="card p-5">
            <h3 className="font-bold text-navy">{pr.flaggedAttempts} ({data.attempts.length})</h3>
            {data.attempts.length === 0 ? <p className="mt-2 text-sm text-slate">{pr.logEmpty}</p> : (
              <ul className="mt-3 divide-y divide-line text-sm">
                {data.attempts.map((a) => (
                  <li key={a.attemptId} className="flex flex-wrap items-center gap-2 py-2">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold text-navy">{a.name} <span className="font-normal text-slate" dir="ltr">{a.email}</span></span>
                      <span className="block truncate text-xs text-slate">{a.course} · {a.exam} · {fmt(a.startedAt)}</span>
                    </span>
                    <span className={cn("rounded-md px-2 py-0.5 text-xs font-semibold", a.reviewFlag || a.status === "UNDER_REVIEW" ? "bg-gold/10 text-gold-600" : "bg-mist text-navy")}>
                      {pr.warnings}: {a.warnings}{a.status === "UNDER_REVIEW" ? ` · ${pr.held}` : ""}
                    </span>
                    <Link href={`/${locale}/exams/attempts?id=${encodeURIComponent(a.examId)}`} className="text-xs font-semibold text-brand hover:underline">{pr.open}</Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="card p-5">
            <h3 className="font-bold text-navy">{pr.eventsTitle} ({data.events.length})</h3>
            {data.events.length === 0 ? <p className="mt-2 text-sm text-slate">{pr.logEmpty}</p> : (
              <ul className="mt-3 max-h-96 divide-y divide-line overflow-y-auto text-sm">
                {data.events.map((e, i) => (
                  <li key={i} className="py-2">
                    <span className="font-semibold text-navy">{(pr.actions as Record<string, string>)[e.action] ?? e.action}</span>
                    <span className="block text-xs text-slate">
                      {fmt(e.at)}{e.actor ? ` · ${e.actor}` : ""}{e.course ? ` · ${e.course}` : ""}
                      {e.action === "security.rate_limit" && e.entity ? ` · ${e.entity}: ${String(e.details?.count ?? "")}/${String(e.details?.limit ?? "")}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
