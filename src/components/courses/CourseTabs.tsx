"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { loadContent, type CourseContent } from "@/lib/exams/courses";
import { cn } from "@/lib/utils";
import { Notice, Spinner, type ExamLabels } from "@/components/exams/ExamShell";
import { contentError } from "./ContentEditor";
import { ContentReport } from "./ContentReport";
import { ContentSection, ProgressBar } from "./ContentSection";

export type CourseTab = "info" | "files" | "videos" | "tests" | "progress";

/** keeps the open tab in the address, so a link or a reload returns to it */
export function useCourseTab(first: CourseTab): [CourseTab, (t: CourseTab) => void] {
  const [tab, setTab] = useState<CourseTab>(() => {
    const q = typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("tab");
    return q === "info" || q === "files" || q === "videos" || q === "tests" || q === "progress" ? q : first;
  });
  const open = useCallback((t: CourseTab) => {
    setTab(t);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", t);
    window.history.replaceState(window.history.state, "", url);
  }, []);
  return [tab, open];
}

/**
 * One course: its three sections — files, educational videos and tests (the exam platform) — plus the
 * trainees' progress for staff, and on the admin dashboard the course data.
 */
export function CourseTabs({
  programId,
  locale,
  labels,
  info,
  tests,
}: {
  programId: string;
  locale: string;
  labels: ExamLabels;
  /** the course data tab (admin dashboard only) */
  info?: ReactNode;
  /** the exam platform's folders; null when the member may not open them */
  tests: ReactNode;
}) {
  const c = labels.content;
  const [tab, setTab] = useCourseTab(info ? "info" : "files");
  const [data, setData] = useState<CourseContent | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      setData(await loadContent(programId));
      setError("");
    } catch (e) {
      setError(contentError(e, labels));
    }
  }, [programId, labels]);

  useEffect(() => {
    setData(null);
    load();
  }, [load]);

  const patch = useCallback((fn: (d: CourseContent) => CourseContent) => setData((d) => (d ? fn(d) : d)), []);

  const count = (s: "MATERIAL" | "VIDEO") => (data ? [...data.items, ...data.shared].filter((i) => i.section === s).length : null);
  const tabs: { key: CourseTab; label: string; n?: number | null }[] = [
    ...(info ? [{ key: "info" as const, label: c.tabs.info }] : []),
    { key: "files", label: c.tabs.files, n: count("MATERIAL") },
    { key: "videos", label: c.tabs.videos, n: count("VIDEO") },
    { key: "tests", label: c.tabs.tests },
    ...(data?.canSeeProgress ? [{ key: "progress" as const, label: c.tabs.progress }] : []),
  ];
  const shown = tab === "progress" && data && !data.canSeeProgress ? "files" : tab === "info" && !info ? "files" : tab;

  return (
    <div className="space-y-6">
      <div role="tablist" aria-label={c.tabs.label} className="flex gap-1 overflow-x-auto overflow-y-hidden border-b border-line">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            id={`course-tab-${t.key}`}
            aria-selected={shown === t.key}
            aria-controls="course-panel"
            onClick={() => setTab(t.key)}
            className={cn("-mb-px whitespace-nowrap border-b-2 px-3.5 py-2.5 text-sm font-bold transition sm:px-5", shown === t.key ? "border-brand text-brand" : "border-transparent text-slate hover:text-navy")}
          >
            {t.label}
            {t.n != null && <span className="ms-1.5 rounded-full bg-mist px-2 py-0.5 text-xs text-slate">{t.n}</span>}
          </button>
        ))}
      </div>

      <div role="tabpanel" id="course-panel" aria-labelledby={`course-tab-${shown}`}>
        {shown === "info" ? (
          info
        ) : shown === "tests" ? (
          (tests ?? <Notice>{c.noTestAccess}</Notice>)
        ) : error ? (
          <Notice tone="error">
            <p>{error}</p>
            <button type="button" onClick={load} className="btn btn-outline btn-sm mt-3">{labels.retry}</button>
          </Notice>
        ) : !data ? (
          <Spinner />
        ) : shown === "progress" ? (
          <ContentReport programId={programId} locale={locale} labels={labels} />
        ) : (
          <div className="space-y-5">
            {!data.staff && data.progress.total > 0 && (
              <div className="card p-4">
                <p className="mb-2 flex flex-wrap justify-between gap-2 text-sm font-semibold text-navy">
                  <span>{c.myProgress}</span>
                  <span>{c.progressText.replace("{done}", String(data.progress.done)).replace("{total}", String(data.progress.total)).replace("{p}", String(data.progress.percent))}</span>
                </p>
                <ProgressBar percent={data.progress.percent} label={c.myProgress} />
              </div>
            )}
            <ContentSection key={shown} programId={programId} section={shown === "videos" ? "VIDEO" : "MATERIAL"} data={data} setData={patch} reload={load} locale={locale} labels={labels} />
          </div>
        )}
      </div>
    </div>
  );
}
