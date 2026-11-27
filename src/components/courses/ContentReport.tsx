"use client";

import { useEffect, useState } from "react";
import { rpc } from "@/lib/exams/client";
import { itemTitle, type ContentReport as Report } from "@/lib/exams/courses";
import { toCsv, toXlsx } from "@/lib/exams/io/sheets";
import { Notice, Spinner, type ExamLabels } from "@/components/exams/ExamShell";
import { CSV_MIME, download, moment, stamp, XLSX_MIME } from "@/components/manage/peopleShared";
import { ProgressBar } from "./ContentSection";
import { contentError } from "./ContentEditor";

/** who has opened and watched what in this course */
export function ContentReport({ programId, locale, labels }: { programId: string; locale: string; labels: ExamLabels }) {
  const r = labels.content.report;
  const [data, setData] = useState<Report | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    rpc<Report>("exam_content_report", { p_program: programId })
      .then((d) => live && setData(d))
      .catch((e) => live && setError(contentError(e, labels)));
    return () => {
      live = false;
    };
  }, [programId, labels]);

  if (error) return <Notice tone="error">{error}</Notice>;
  if (!data) return <Spinner />;

  const minutes = (s: number) => Math.round(s / 60);
  const people = [
    [r.trainee, r.email, r.completed, r.total, r.percent, r.minutes, r.last],
    ...data.trainees.map((t) => [t.name, t.email, t.progress.done, t.progress.total, t.progress.percent, minutes(t.videoSeconds), t.progress.lastAt ? moment(t.progress.lastAt, locale) : ""]),
  ];
  const items = [
    [r.item, r.openedBy, r.completedBy, r.average],
    ...data.items.map((i) => [itemTitle(i, locale), i.openedBy, i.completedBy, i.avgPercent]),
  ];
  const excel = () => download(`course-progress-${stamp()}.xlsx`, toXlsx([{ name: r.trainees, rows: people }, { name: r.items, rows: items }], locale === "ar") as BlobPart, XLSX_MIME);
  const csv = () => download(`course-progress-${stamp()}.csv`, toCsv(people), CSV_MIME);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="max-w-3xl text-sm leading-6 text-slate">{r.note}</p>
        <div className="flex gap-2">
          <button type="button" onClick={excel} className="btn btn-outline btn-sm">{r.excel}</button>
          <button type="button" onClick={csv} className="btn btn-outline btn-sm">{r.csv}</button>
        </div>
      </div>

      <section className="card overflow-x-auto">
        <h3 className="border-b border-line px-4 py-3 font-bold text-navy">{r.trainees} <span className="text-slate">({data.trainees.length})</span></h3>
        {data.trainees.length === 0 ? (
          <p className="px-4 py-4 text-sm text-slate">{r.noTrainees}</p>
        ) : (
          <table className="w-full min-w-[34rem] text-sm">
            <thead className="bg-mist/60 text-slate">
              <tr>{[r.trainee, r.progress, r.minutes, r.last].map((h) => <th key={h} className="px-4 py-2 text-start font-semibold">{h}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-line">
              {data.trainees.map((t) => (
                <tr key={t.id}>
                  <td className="px-4 py-2.5">
                    <span className="block font-semibold text-navy">{t.name || t.email}</span>
                    <span className="block text-xs text-slate" dir="ltr">{t.email}</span>
                    {!t.open && <span className="mt-1 inline-block rounded-md bg-gold/10 px-1.5 py-0.5 text-xs font-semibold text-gold-600">{r.closed}</span>}
                  </td>
                  <td className="w-52 px-4 py-2.5">
                    <ProgressBar percent={t.progress.percent} label={t.name || t.email} />
                    <span className="mt-1 block text-xs text-slate">{t.progress.done} / {t.progress.total} · {t.progress.percent}%</span>
                  </td>
                  <td className="px-4 py-2.5">{minutes(t.videoSeconds)}</td>
                  <td className="px-4 py-2.5 text-slate">{t.progress.lastAt ? moment(t.progress.lastAt, locale) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="card overflow-x-auto">
        <h3 className="border-b border-line px-4 py-3 font-bold text-navy">{r.items} <span className="text-slate">({data.items.length})</span></h3>
        {data.items.length === 0 ? (
          <p className="px-4 py-4 text-sm text-slate">{r.noItems}</p>
        ) : (
          <table className="w-full min-w-[30rem] text-sm">
            <thead className="bg-mist/60 text-slate">
              <tr>{[r.item, r.openedBy, r.completedBy, r.average].map((h) => <th key={h} className="px-4 py-2 text-start font-semibold">{h}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-line">
              {data.items.map((i) => (
                <tr key={i.id}>
                  <td className="px-4 py-2.5">
                    <span className="font-semibold text-navy">{itemTitle(i, locale)}</span>
                    <span className="ms-2 text-xs text-slate">{i.section === "VIDEO" ? labels.content.tabs.videos : labels.content.tabs.files}{!i.published && ` · ${labels.content.hidden}`}</span>
                  </td>
                  <td className="px-4 py-2.5">{i.openedBy}</td>
                  <td className="px-4 py-2.5">{i.completedBy}</td>
                  <td className="px-4 py-2.5">{i.avgPercent}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
