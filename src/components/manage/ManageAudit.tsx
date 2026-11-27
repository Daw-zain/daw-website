"use client";

import { useEffect, useState } from "react";
import { can, ExamError, rpc, utcDate, type ExamMe } from "@/lib/exams/client";
import { auditDetails, type AuditData, type AuditItem } from "@/lib/exams/manage";
import { toCsv, toXlsx } from "@/lib/exams/io/sheets";
import { cn } from "@/lib/utils";
import { Notice, Spinner, type ExamLabels } from "@/components/exams/ExamShell";
import { SecurityLog } from "@/components/exams/SecurityLog";
import { ManageShell, SectionTitle } from "./ManageShell";

/** /[locale]/manage/audit — the activity log of the platform and of the website dashboard, plus security alerts */
export function ManageAudit({ locale, labels }: { locale: string; labels: ExamLabels }) {
  return (
    <ManageShell locale={locale} labels={labels} section="audit">
      {(me) => <Audit me={me} locale={locale} labels={labels} />}
    </ManageShell>
  );
}

type Filter = { q: string; area: string; source: string; from: string; to: string };
const NONE: Filter = { q: "", area: "", source: "", from: "", to: "" };

export const auditName = (action: string, labels: ExamLabels) => (labels.manage.audit.actions as Record<string, string>)[action] ?? action;
export const auditWhen = (v: string, locale: string) => utcDate(v)?.toLocaleString(locale === "ar" ? "ar-LY" : "en-GB", { dateStyle: "medium", timeStyle: "short" }) ?? v;

function download(name: string, data: BlobPart, mime: string) {
  const url = URL.createObjectURL(new Blob([data], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function Audit({ me, locale, labels }: { me: ExamMe; locale: string; labels: ExamLabels }) {
  const t = labels.manage.audit;
  const [tab, setTab] = useState<"log" | "security">("log");
  const [filter, setFilter] = useState<Filter>(NONE);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<AuditData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  const clean = (f: Filter) => Object.fromEntries(Object.entries(f).filter(([, v]) => v !== ""));
  const errorText = (e: unknown) => (e instanceof ExamError && /rate_limited/.test(e.message) ? labels.analytics.rateLimited : labels.errorGeneric);

  useEffect(() => {
    let live = true;
    setLoading(true);
    setError(null);
    // typing a name waits a moment before asking the database
    const timer = setTimeout(
      () =>
        rpc<AuditData>("exam_audit", { p_filter: { ...clean(filter), page } })
          .then((d) => live && setData(d))
          .catch((e) => live && setError(errorText(e)))
          .finally(() => live && setLoading(false)),
      filter.q ? 400 : 0,
    );
    return () => {
      live = false;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter, page]);

  const set = (patch: Partial<Filter>) => {
    setPage(1);
    setNote(null);
    setFilter((f) => ({ ...f, ...patch }));
  };

  const who = (x: AuditItem) => x.actorName || x.actorEmail || t.system;
  const sourceName = (x: AuditItem) => t.sources[x.source];

  const exportLog = async (kind: "xlsx" | "csv") => {
    setExporting(true);
    setError(null);
    setNote(null);
    try {
      const all = await rpc<AuditData>("exam_audit", { p_filter: { ...clean(filter), export: true } });
      const c = t.cols;
      const rows = [
        [c.when, c.who, labels.analytics.cols.email, c.what, c.course, c.details, c.source],
        ...all.items.map((x) => [utcDate(x.at)?.toISOString().slice(0, 19).replace("T", " ") ?? x.at, who(x), x.actorEmail ?? "", auditName(x.action, labels), x.course ?? "", auditDetails(x.details), sourceName(x)]),
      ];
      const name = `activity-log-${new Date().toISOString().slice(0, 10)}`;
      if (kind === "csv") download(`${name}.csv`, toCsv(rows), "text/csv;charset=utf-8");
      else download(`${name}.xlsx`, toXlsx([{ name: t.title, rows }], locale === "ar") as BlobPart, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      if (all.total > all.items.length) setNote(t.capped.replace("{n}", String(all.items.length)));
    } catch (e) {
      setError(errorText(e));
    }
    setExporting(false);
  };

  const pages = Math.max(1, Math.ceil((data?.total ?? 0) / (data?.pageSize ?? 50)));
  const filtered = JSON.stringify(filter) !== JSON.stringify(NONE);
  const th = "whitespace-nowrap px-3 py-2 text-start text-xs font-semibold text-slate";
  const td = "px-3 py-2 align-top text-sm";

  return (
    <div className="space-y-5">
      <SectionTitle title={t.title} text={t.intro} />
      <div className="flex flex-wrap gap-2" role="tablist">
        {(["log", "security"] as const).map((k) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={cn("btn btn-sm", tab === k ? "btn-primary" : "btn-outline")}>{t.tabs[k]}</button>
        ))}
      </div>

      {tab === "security" ? (
        <SecurityLog locale={locale} labels={labels} />
      ) : (
        <>
          <div className="card grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-5">
            <label className="text-sm font-semibold text-navy">
              {t.person}
              <input type="search" className="field mt-1 w-full" value={filter.q} onChange={(e) => set({ q: e.target.value })} />
            </label>
            <label className="text-sm font-semibold text-navy">
              {t.area}
              <select className="field mt-1 w-full" value={filter.area} onChange={(e) => set({ area: e.target.value })}>
                <option value="">{t.all}</option>
                {data?.areas.slice().sort().map((a) => <option key={a} value={a}>{(t.areas as Record<string, string>)[a] ?? a}</option>)}
              </select>
            </label>
            <label className="text-sm font-semibold text-navy">
              {t.source}
              <select className="field mt-1 w-full" value={filter.source} onChange={(e) => set({ source: e.target.value })}>
                <option value="">{t.sources.all}</option>
                <option value="platform">{t.sources.platform}</option>
                <option value="website">{t.sources.website}</option>
              </select>
            </label>
            <label className="text-sm font-semibold text-navy">
              {t.from}
              <input type="date" className="field mt-1 w-full" value={filter.from} onChange={(e) => set({ from: e.target.value })} />
            </label>
            <label className="text-sm font-semibold text-navy">
              {t.to}
              <input type="date" className="field mt-1 w-full" value={filter.to} onChange={(e) => set({ to: e.target.value })} />
            </label>
            <div className="flex flex-wrap items-center gap-2 sm:col-span-2 xl:col-span-5">
              {data && <span className="text-sm text-slate">{t.total.replace("{n}", String(data.total))}</span>}
              {filtered && <button type="button" className="btn btn-outline btn-sm" onClick={() => set(NONE)}>{t.reset}</button>}
              <span className="flex-1" />
              {can(me, "audit", "export") && (
                <>
                  <button type="button" disabled={exporting || !data?.total} className="btn btn-primary btn-sm" onClick={() => exportLog("xlsx")}>{t.exportExcel}</button>
                  <button type="button" disabled={exporting || !data?.total} className="btn btn-outline btn-sm" onClick={() => exportLog("csv")}>{t.exportCsv}</button>
                </>
              )}
            </div>
          </div>

          {error && <Notice tone="error">{error}</Notice>}
          {note && <Notice>{note}</Notice>}
          {loading && <Spinner />}
          {!loading && data && (
            <div className="card overflow-x-auto">
              {data.items.length === 0 ? (
                <p className="p-4 text-sm text-slate">{t.empty}</p>
              ) : (
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-line">
                      {[t.cols.when, t.cols.who, t.cols.what, t.cols.course, t.cols.details].map((h) => <th key={h} scope="col" className={th}>{h}</th>)}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {data.items.map((x, i) => (
                      <tr key={`${x.at}-${x.action}-${x.entityId}-${i}`}>
                        <td className={cn(td, "whitespace-nowrap")}>{auditWhen(x.at, locale)}</td>
                        <td className={td}>
                          <span className="block font-semibold text-navy">{who(x)}</span>
                          {x.actorEmail && <span className="block text-xs text-slate" dir="ltr">{x.actorEmail}</span>}
                        </td>
                        <td className={td}>
                          {auditName(x.action, labels)}
                          {x.source === "website" && <span className="ms-1 rounded-md bg-mist px-1.5 py-0.5 text-xs text-slate">{sourceName(x)}</span>}
                        </td>
                        <td className={td}>{x.course ?? "—"}</td>
                        <td className={cn(td, "min-w-56 max-w-sm")}>
                          <span className="line-clamp-2 break-all text-xs text-slate" dir="auto" title={auditDetails(x.details)}>{auditDetails(x.details) || "—"}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
          {pages > 1 && (
            <div className="flex items-center justify-center gap-3 text-sm">
              <button type="button" disabled={page <= 1 || loading} onClick={() => setPage(page - 1)} className="btn btn-outline btn-sm">{t.prev}</button>
              <span className="text-slate">{t.page.replace("{p}", String(page)).replace("{n}", String(pages))}</span>
              <button type="button" disabled={page >= pages || loading} onClick={() => setPage(page + 1)} className="btn btn-outline btn-sm">{t.next}</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
