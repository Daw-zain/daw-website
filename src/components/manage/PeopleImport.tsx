"use client";

import { useState } from "react";
import { rpc, type ExamMe } from "@/lib/exams/client";
import { accounts } from "@/lib/exams/people";
import { peopleTemplate, rowsToPeople, type PersonRow } from "@/lib/exams/io/people";
import { parseCsvRows, readXlsx } from "@/lib/exams/io/tabular";
import { toCsv, toXlsx } from "@/lib/exams/io/sheets";
import { cn } from "@/lib/utils";
import { Notice, type ExamLabels } from "@/components/exams/ExamShell";
import { CSV_MIME, download, peopleError, stamp, XLSX_MIME } from "./peopleShared";

type Verdict = { row: number; email: string; programId: string | null; problem: string | null; memberId: string | null };
type Line = PersonRow & Verdict;
type Outcome = { line: Line; result: "created" | "subscribed" | "created_subscribed" | "failed"; reason?: string };

const BATCH = 25;

/** import trainees from an Excel or CSV file: read here, checked by the database, then created in batches */
export function PeopleImport({ me, course, locale, labels, onDone, onClose }: { me: ExamMe; course: string; locale: string; labels: ExamLabels; onDone: () => void; onClose: () => void }) {
  const t = labels.manage.people.import;
  const mayEnroll = !!me.platform.trainees?.includes("update");
  const [lines, setLines] = useState<Line[] | null>(null);
  const [until, setUntil] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Outcome[] | null>(null);

  const read = async (file: File) => {
    setError(null);
    setDone(null);
    setLines(null);
    setBusy(t.reading);
    try {
      if (file.size > 5 * 1024 * 1024) throw new Error("file");
      const table = /\.xlsx$/i.test(file.name) ? await readXlsx(await file.arrayBuffer()) : parseCsvRows(await file.text());
      const parsed = rowsToPeople(table);
      if (parsed.error) {
        setError(t.errors[parsed.error]);
      } else {
        const verdicts = await rpc<Verdict[]>("exam_people_import_check", { p_items: parsed.rows.map((r) => ({ email: r.email, name: r.name, phone: r.phone, course: r.course })) });
        setLines(verdicts.map((v) => ({ ...parsed.rows[v.row - 1], ...v })));
      }
    } catch (e) {
      setError((e as Error).message === "file" || (e as Error).message === "not_xlsx" ? t.errors.file : peopleError(e, labels));
    }
    setBusy(null);
  };

  const good = lines?.filter((l) => !l.problem) ?? [];
  const fresh = good.filter((l) => !l.memberId);
  const existing = good.filter((l) => l.memberId);
  const runnable = fresh.length + (mayEnroll ? existing.filter((l) => l.programId).length : 0);

  const run = async () => {
    setError(null);
    const out: Outcome[] = [];
    const made: { line: Line; memberId: string }[] = [];
    let stopped: string | null = null;
    // 1. new accounts, 25 at a time
    for (let i = 0; i < fresh.length && !stopped; i += BATCH) {
      setBusy(t.running.replace("{done}", String(i)).replace("{n}", String(fresh.length)));
      const batch = fresh.slice(i, i + BATCH);
      try {
        const r = await accounts<{ results: { memberId?: string; error?: string }[] }>(
          { action: "createMany", accounts: batch.map((l) => ({ email: l.email, name: l.name, role: "LEARNER", phone: l.phone, organization: l.organization, jobTitle: l.jobTitle, city: l.city })) },
          locale,
        );
        r.results.forEach((x, k) => {
          if (x.memberId) made.push({ line: batch[k], memberId: x.memberId });
          else out.push({ line: batch[k], result: "failed", reason: (labels.manage.people.errors as Record<string, string>)[x.error ?? "failed"] ?? labels.errorGeneric });
        });
      } catch (e) {
        stopped = peopleError(e, labels);
        for (const l of fresh.slice(i)) out.push({ line: l, result: "failed", reason: stopped });
      }
    }
    // 2. subscriptions, one request per course
    const wanted = [...made, ...existing.map((line) => ({ line, memberId: line.memberId! }))].filter((x) => mayEnroll && x.line.programId);
    const failed = new Map<string, string>();
    for (const programId of new Set(wanted.map((x) => x.line.programId!))) {
      const group = wanted.filter((x) => x.line.programId === programId);
      for (let i = 0; i < group.length; i += 200) {
        const part = group.slice(i, i + 200);
        try {
          await rpc("exam_enrollment_set", { p_members: part.map((x) => x.memberId), p_program: programId, p_data: { status: "ACTIVE", ...(until ? { expiresAt: until } : {}) } });
        } catch (e) {
          for (const x of part) failed.set(x.memberId, peopleError(e, labels));
        }
      }
    }
    for (const x of made) {
      const sub = wanted.some((w) => w.memberId === x.memberId);
      out.push({ line: x.line, result: sub && !failed.has(x.memberId) ? "created_subscribed" : "created", reason: failed.get(x.memberId) });
    }
    for (const line of existing) {
      if (!wanted.some((w) => w.memberId === line.memberId)) continue;
      out.push({ line, result: failed.has(line.memberId!) ? "failed" : "subscribed", reason: failed.get(line.memberId!) });
    }
    setDone(out.sort((a, b) => a.line.row - b.line.row));
    setLines(null);
    setBusy(null);
    if (stopped) setError(stopped);
    onDone();
  };

  const report = () => {
    if (!done) return;
    const rows = [
      [t.row, labels.manage.people.cols.name, labels.manage.people.cols.email, t.result, t.reason],
      ...done.map((d) => [d.line.row + 1, d.line.name, d.line.email, t.results[d.result], d.reason ?? ""]),
    ];
    download(`trainees-import-${stamp()}.xlsx`, toXlsx([{ name: t.title, rows }], locale === "ar") as BlobPart, XLSX_MIME);
  };
  const template = (kind: "xlsx" | "csv") => {
    const rows = peopleTemplate(locale, course);
    if (kind === "csv") download("trainees-template.csv", toCsv(rows), CSV_MIME);
    else download("trainees-template.xlsx", toXlsx([{ name: t.title, rows }], locale === "ar") as BlobPart, XLSX_MIME);
  };
  const count = (r: Outcome["result"][]) => done?.filter((d) => r.includes(d.result)).length ?? 0;
  const td = "px-3 py-2 align-top text-sm";

  return (
    <section className="card space-y-4 p-5" aria-label={t.title}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-bold text-navy">{t.title}</h3>
          <p className="max-w-2xl text-sm leading-6 text-slate">{t.intro}</p>
        </div>
        <button type="button" onClick={onClose} className="btn btn-outline btn-sm" disabled={!!busy}>{labels.manage.people.form.close}</button>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <label className="btn btn-primary btn-sm cursor-pointer">
          {t.choose}
          <input type="file" accept=".xlsx,.csv,text/csv" className="sr-only" disabled={!!busy} onChange={(e) => { const f = e.target.files?.[0]; if (f) read(f); e.target.value = ""; }} />
        </label>
        <span className="text-sm text-slate">{t.template}</span>
        <button type="button" onClick={() => template("xlsx")} className="btn btn-outline btn-sm">Excel</button>
        <button type="button" onClick={() => template("csv")} className="btn btn-outline btn-sm">CSV</button>
      </div>
      {busy && <Notice>{busy}</Notice>}
      {error && <Notice tone="error">{error}</Notice>}

      {lines && (
        <>
          <p className="text-sm font-semibold text-navy" role="status">
            {t.summary.replace("{new}", String(fresh.length)).replace("{sub}", String(existing.length)).replace("{bad}", String(lines.length - good.length))}
          </p>
          <div className="max-h-96 overflow-auto rounded-xl border border-line">
            <table className="w-full">
              <thead className="sticky top-0 bg-white">
                <tr className="border-b border-line">
                  {[t.row, labels.manage.people.cols.name, labels.manage.people.cols.email, labels.admin.course, t.result].map((h) => <th key={h} scope="col" className="px-3 py-2 text-start text-xs font-semibold text-slate">{h}</th>)}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {lines.map((l) => (
                  <tr key={l.row} className={cn(l.problem && "bg-gold/5")}>
                    <td className={td}>{l.row + 1}</td>
                    <td className={td}>{l.name}</td>
                    <td className={td} dir="ltr">{l.email}</td>
                    <td className={td}><bdi>{l.course || "—"}</bdi></td>
                    <td className={cn(td, l.problem ? "text-gold-600" : "text-emerald-700")}>
                      {l.problem ? t.problems[l.problem as keyof typeof t.problems] ?? l.problem : l.memberId ? t.willSubscribe : t.willCreate}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {mayEnroll && good.some((l) => l.programId) && (
            <label className="block text-sm">
              <span className="mb-1 block font-semibold text-navy">{t.until}</span>
              <input type="date" value={until} onChange={(e) => setUntil(e.target.value)} className="field w-auto" />
              <span className="ms-2 text-xs text-slate">{labels.manage.people.untilHint}</span>
            </label>
          )}
          {!mayEnroll && good.some((l) => l.programId) && <Notice>{t.noEnroll}</Notice>}
          <p className="text-xs leading-5 text-slate">{t.linkNote}</p>
          <button type="button" disabled={!!busy || runnable === 0} onClick={run} className="btn btn-primary btn-sm">
            {t.run.replace("{n}", String(runnable))}
          </button>
        </>
      )}

      {done && (
        <Notice tone={count(["failed"]) ? "error" : "success"}>
          <p className="font-semibold">
            {t.done.replace("{created}", String(count(["created", "created_subscribed"]))).replace("{subscribed}", String(count(["subscribed", "created_subscribed"]))).replace("{failed}", String(count(["failed"])))}
          </p>
          <p>{t.linkNote}</p>
          <button type="button" onClick={report} className="btn btn-outline btn-sm mt-2">{t.report}</button>
        </Notice>
      )}
    </section>
  );
}
