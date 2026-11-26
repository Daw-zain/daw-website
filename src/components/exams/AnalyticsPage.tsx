"use client";

import { Fragment, Suspense, useCallback, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { courseTitle, ExamError, rpc, useExamSession, utcDate, type ExamCourse } from "@/lib/exams/client";
import { title } from "@/lib/exams/bank";
import { NO_ANALYTICS_FILTER, pct, questionFlags, SCOPES, type AnalyticsFilter, type Breakdown, type CourseReport, type MyReport, type QuestionAnalysis, type QuestionStat } from "@/lib/exams/analytics";
import { toCsv, toXlsx, type Sheet } from "@/lib/exams/io/sheets";
import { cn } from "@/lib/utils";
import { ExamShell, Notice, Spinner, type ExamLabels } from "./ExamShell";
import { Bars, Columns, Stat } from "./AnalyticsCharts";

/** /[locale]/exams/analytics?id=<programId> — course reports for staff, personal report for everyone (no id = all courses) */
export function AnalyticsPage(props: { locale: string; labels: ExamLabels; homeLabel: string }) {
  return (
    <Suspense fallback={<Spinner />}>
      <Inner {...props} />
    </Suspense>
  );
}

function Inner({ locale, labels, homeLabel }: { locale: string; labels: ExamLabels; homeLabel: string }) {
  const programId = useSearchParams().get("id") ?? "";
  const { state, reload } = useExamSession(locale);
  const an = labels.analytics;
  const course = state.status === "ready" ? state.me.courses.find((c) => c.programId === programId) : undefined;
  const staff = !!course && (course.access === "ADMIN" || (course.access === "INSTRUCTOR" && !!course.permissions?.canViewResults));
  const [tab, setTab] = useState<"course" | "mine">("course");

  return (
    <ExamShell
      locale={locale}
      labels={labels}
      state={state}
      reload={reload}
      title={staff ? an.title : an.mineTitle}
      text={course ? courseTitle(course, locale) : undefined}
      crumbs={[
        { href: `/${locale}`, label: homeLabel },
        { href: `/${locale}/exams`, label: labels.title },
        ...(course ? [{ href: `/${locale}/exams/course?id=${encodeURIComponent(programId)}`, label: course.code ?? courseTitle(course, locale) }] : []),
        { label: staff ? an.title : an.mineTitle },
      ]}
    >
      {(me) =>
        programId && !course ? (
          <Notice tone="error">{labels.course.notFound}</Notice>
        ) : (
          <div className="space-y-6">
            {staff && <Tabs value={tab} onChange={setTab} items={[["course", an.tabCourse], ["mine", an.tabMine]]} />}
            {staff && tab === "course" ? (
              <CourseReportView course={course!} locale={locale} labels={labels} />
            ) : (
              <MyReportView programId={programId || null} courses={me.courses} locale={locale} labels={labels} />
            )}
          </div>
        )
      }
    </ExamShell>
  );
}

// ── shared pieces ──

function Tabs<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: [T, string][] }) {
  return (
    <div className="flex flex-wrap gap-2" role="tablist">
      {items.map(([k, label]) => (
        <button key={k} type="button" role="tab" aria-selected={value === k} onClick={() => onChange(k)} className={cn("btn btn-sm", value === k ? "btn-primary" : "btn-outline")}>
          {label}
        </button>
      ))}
    </div>
  );
}

const TH = "whitespace-nowrap px-3 py-2 text-start text-xs font-semibold text-slate";
const TD = "px-3 py-2 align-top text-sm";

function Table({ heading, head, empty, count, children }: { heading?: string; head: string[]; empty: string; count: number; children: ReactNode }) {
  return (
    <div className="card overflow-x-auto">
      {heading && <h3 className="px-4 pt-4 font-bold text-navy">{heading}</h3>}
      {count === 0 ? (
        <p className="p-4 text-sm text-slate">{empty}</p>
      ) : (
        <table className="mt-2 w-full">
          <thead>
            <tr className="border-b border-line">
              {head.map((h) => (
                <th key={h} scope="col" className={TH}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">{children}</tbody>
        </table>
      )}
    </div>
  );
}

const Person = ({ name, email }: { name: string; email: string }) => (
  <>
    <span className="block font-semibold text-navy">{name}</span>
    <span className="block text-xs text-slate" dir="ltr">{email}</span>
  </>
);

type Group = "domainId" | "topicId" | "type" | "difficulty";

function groupLabel(b: Breakdown, group: Group, locale: string, labels: ExamLabels) {
  if (group === "type") return labels.bank.types[b.key as keyof ExamLabels["bank"]["types"]] ?? b.key ?? "—";
  if (group === "difficulty") return labels.bank.difficulties[b.key as keyof ExamLabels["bank"]["difficulties"]] ?? labels.analytics.uncategorized;
  return (locale === "ar" ? b.nameAr || b.nameEn : b.nameEn || b.nameAr) || labels.analytics.uncategorized;
}

function Breakdowns({ data, locale, labels }: { data: { domains: Breakdown[]; topics: Breakdown[]; types: Breakdown[]; difficulties: Breakdown[] }; locale: string; labels: ExamLabels }) {
  const an = labels.analytics;
  const cards: [string, Breakdown[], Group][] = [
    [an.byDomain, data.domains, "domainId"],
    [an.byTopic, data.topics, "topicId"],
    [an.byType, data.types, "type"],
    [an.byDifficulty, data.difficulties, "difficulty"],
  ];
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {cards.map(([heading, rows, group]) => (
        <div key={group} className="card p-5">
          <h3 className="font-bold text-navy">{heading}</h3>
          <p className="mb-3 mt-0.5 text-xs text-slate">{an.scoreHint}</p>
          <Bars
            empty={an.noData}
            rows={rows.map((b) => ({ key: b.key ?? "-", label: groupLabel(b, group, locale, labels), value: b.scorePct, text: pct(b.scorePct), note: an.askedCorrect.replace("{asked}", String(b.asked)).replace("{correct}", String(b.correct)) }))}
          />
        </div>
      ))}
    </div>
  );
}

function breakdownSheet(name: string, rows: Breakdown[], group: Group, locale: string, labels: ExamLabels): Sheet {
  const c = labels.analytics.cols;
  return { name, rows: [[c.category, c.questions, c.asked, c.answered, c.correct, c.score], ...rows.map((b) => [groupLabel(b, group, locale, labels), b.questions, b.asked, b.answered, b.correct, b.scorePct])] };
}

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
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const stamp = () => new Date().toISOString().slice(0, 10);
const when = (v: string | null | undefined) => utcDate(v)?.toISOString().slice(0, 16).replace("T", " ") ?? "";
const localWhen = (v: string | null, locale: string) => utcDate(v)?.toLocaleString(locale === "ar" ? "ar-LY" : "en-GB", { dateStyle: "medium", timeStyle: "short" }) ?? "—";

function errorText(e: unknown, labels: ExamLabels) {
  return e instanceof ExamError && /rate_limited/.test(e.message) ? labels.analytics.rateLimited : labels.errorGeneric;
}

// ── staff: course report ──

const SECTIONS = ["overview", "questions", "exams", "learners", "attempts", "mistakes", "security"] as const;
type Section = (typeof SECTIONS)[number];

const rpcFilter = (f: AnalyticsFilter) => Object.fromEntries(Object.entries(f).filter(([, v]) => v !== ""));

/** every table of the report as spreadsheet sheets (same order as the tabs) */
function courseSheets(r: CourseReport, locale: string, labels: ExamLabels): Record<Section, Sheet[]> {
  const an = labels.analytics;
  const c = an.cols;
  const s = r.summary;
  const statuses = labels.take.statuses;
  const T = (v: { titleAr: string; titleEn: string }) => title(v, locale);
  const yesNo = (v: boolean | null) => (v === null ? "" : v ? an.yes : an.no);
  return {
    overview: [
      {
        name: an.sections.overview,
        rows: [
          [c.metric, c.value],
          [an.countedAttempts, s.counted],
          [an.allAttempts, s.attempts],
          [an.learnersCount, s.learners],
          [an.avg, s.avgPercent],
          [an.median, s.medianPercent],
          [an.min, s.minPercent],
          [an.max, s.maxPercent],
          [an.passRate, s.passRate],
          [an.avgMinutes, s.avgMinutes],
          [an.pendingGrading, s.pendingGrading],
          [an.inProgress, s.inProgress],
          [an.underReview, s.underReview],
          [an.cancelled, s.cancelled],
          [an.scopeLabel, an.scopes[(r as CourseReport & { filter?: AnalyticsFilter }).filter?.scope ?? "all"]],
          [an.generated, when(r.generatedAt.replace(/\+.*$/, ""))],
        ],
      },
      { name: an.distribution, rows: [[an.band, c.attempts], ...r.distribution.map((b) => [`${b.from}-${b.to}%`, b.count])] },
      breakdownSheet(an.byDomain, r.domains, "domainId", locale, labels),
      breakdownSheet(an.byTopic, r.topics, "topicId", locale, labels),
      breakdownSheet(an.byType, r.types, "type", locale, labels),
      breakdownSheet(an.byDifficulty, r.difficulties, "difficulty", locale, labels),
    ],
    questions: [
      {
        name: an.sections.questions,
        rows: [
          [c.question, c.type, c.difficulty, c.domain, c.asked, c.answered, c.correct, c.wrong, c.unanswered, c.facility, c.discrimination, c.flags],
          ...r.questions.map((q) => [
            locale === "ar" ? q.stemAr || q.stemEn : q.stemEn || q.stemAr,
            labels.bank.types[q.type],
            labels.bank.difficulties[q.difficulty as "EASY"] ?? q.difficulty,
            (locale === "ar" ? q.domainAr || q.domainEn : q.domainEn || q.domainAr) ?? "",
            q.asked, q.answered, q.correct, q.wrong, q.unanswered, q.facility, q.discrimination,
            questionFlags(q).map((f) => an.flags[f]).join("، "),
          ]),
        ],
      },
    ],
    exams: [
      {
        name: an.sections.exams,
        rows: [
          [c.exam, c.attempts, c.counted, c.learners, c.avg, c.min, c.max, c.passRate, c.passMark, c.minutes, c.timedOut],
          ...r.exams.map((e) => [T(e), e.attempts, e.counted, e.learners, e.avgPercent, e.minPercent, e.maxPercent, e.passRate, Number(e.passPercent), e.avgMinutes, e.timedOut]),
        ],
      },
      {
        name: an.improvement,
        rows: [[c.learner, c.email, c.exam, c.attempts, c.first, c.last, c.best, c.change], ...r.improvement.rows.map((x) => [x.name, x.email, T(x), x.attempts, x.first, x.last, x.best, x.change])],
      },
    ],
    learners: [
      {
        name: an.sections.learners,
        rows: [
          [c.learner, c.email, c.attempts, c.counted, c.exams, c.examsPassed, c.avg, c.best, c.last, c.warnings],
          ...r.learners.map((l) => [l.name, l.email, l.attempts, l.counted, l.exams, l.examsPassed, l.avgPercent, l.bestPercent, l.lastPercent, Number(l.warnings)]),
        ],
      },
    ],
    attempts: [
      {
        name: an.sections.attempts,
        rows: [
          [c.learner, c.email, c.exam, c.attemptNo, c.status, c.started, c.submitted, c.minutes, c.score, c.maxScore, c.percent, c.passed, c.questions, c.answered, c.unanswered, c.correct, c.wrong, c.flagged, c.warnings, c.isCounted],
          ...r.attemptsList.map((a) => [
            a.name, a.email, T(a), a.attemptNo, statuses[a.status as keyof typeof statuses] ?? a.status, when(a.startedAt), when(a.submittedAt), a.minutes,
            a.score, a.maxScore, a.percent, yesNo(a.passed), a.questions, a.answered, a.unanswered, a.correct, a.wrong, a.flagged, a.warnings, yesNo(a.counted),
          ]),
        ],
      },
    ],
    mistakes: [
      {
        name: an.sections.mistakes,
        rows: [
          [c.metric, c.value],
          [an.mistakeTotal, r.mistakes.total],
          [an.learnersCount, r.mistakes.learners],
          [an.mastered, r.mistakes.mastered],
          [an.stillWrong, r.mistakes.stillWrong],
          [an.beingReviewed, r.mistakes.inProgress],
          [an.wrongTotal, Number(r.mistakes.wrongTotal)],
          [an.reviewCorrect, Number(r.mistakes.reviewCorrect)],
          [an.reviewWrong, Number(r.mistakes.reviewWrong)],
          [an.sessions, r.mistakes.sessions],
        ],
      },
    ],
    security: [
      {
        name: an.sections.security,
        rows: [
          [c.time, c.event, c.countedWarning, c.learner, c.email, c.exam],
          ...r.security.events.map((e) => [when(e.at), labels.proctor.events[e.kind as keyof ExamLabels["proctor"]["events"]] ?? e.kind, yesNo(e.counted), e.name, e.email, T(e)]),
        ],
      },
    ],
  };
}

function CourseReportView({ course, locale, labels }: { course: ExamCourse; locale: string; labels: ExamLabels }) {
  const an = labels.analytics;
  const [filter, setFilter] = useState<AnalyticsFilter>(NO_ANALYTICS_FILTER);
  const [data, setData] = useState<CourseReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [section, setSection] = useState<Section>("overview");

  useEffect(() => {
    let live = true;
    setLoading(true);
    setError(null);
    rpc<CourseReport>("exam_analytics_course", { p_program: course.programId, p_filter: rpcFilter(filter) })
      .then((d) => live && setData(d))
      .catch((e) => live && (setData(null), setError(errorText(e, labels))))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [course.programId, filter, labels]);

  // exporting asks the database again with export: true, which also records it in the audit log
  const exportReport = async (kind: "xlsx" | "csv") => {
    setExporting(true);
    setError(null);
    try {
      const fresh = await rpc<CourseReport>("exam_analytics_course", { p_program: course.programId, p_filter: { ...rpcFilter(filter), export: true } });
      const all = courseSheets(fresh, locale, labels);
      const base = `${course.code || "course"}-${kind === "csv" ? section : "report"}-${stamp()}`;
      if (kind === "xlsx") download(`${base}.xlsx`, toXlsx(SECTIONS.flatMap((s) => all[s]), locale === "ar") as BlobPart, XLSX_MIME);
      else {
        // one CSV holds one table; the overview joins its small tables one under the other
        const rows = section === "overview" ? all.overview.flatMap((s, i) => [...(i ? [[], [s.name]] : []), ...s.rows]) : all[section][0].rows;
        download(`${base}.csv`, toCsv(rows), "text/csv;charset=utf-8");
      }
    } catch (e) {
      setError(errorText(e, labels));
    }
    setExporting(false);
  };

  const set = (patch: Partial<AnalyticsFilter>) => setFilter((f) => ({ ...f, ...patch }));
  const filtered = JSON.stringify(filter) !== JSON.stringify(NO_ANALYTICS_FILTER);
  const input = "field w-full";

  return (
    <div className="space-y-6">
      <div className="card grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-5">
        <label className="text-sm font-semibold text-navy">
          {an.cols.exam}
          <select className={cn(input, "mt-1")} value={filter.examId} onChange={(e) => set({ examId: e.target.value })}>
            <option value="">{an.all}</option>
            {data?.options.exams.map((x) => <option key={x.id} value={x.id}>{title(x, locale)}</option>)}
          </select>
        </label>
        <label className="text-sm font-semibold text-navy">
          {an.cols.learner}
          <select className={cn(input, "mt-1")} value={filter.memberId} onChange={(e) => set({ memberId: e.target.value })}>
            <option value="">{an.all}</option>
            {data?.options.learners.map((x) => <option key={x.id} value={x.id}>{x.name || x.email}</option>)}
          </select>
        </label>
        <label className="text-sm font-semibold text-navy">
          {an.from}
          <input type="date" className={cn(input, "mt-1")} value={filter.from} onChange={(e) => set({ from: e.target.value })} />
        </label>
        <label className="text-sm font-semibold text-navy">
          {an.to}
          <input type="date" className={cn(input, "mt-1")} value={filter.to} onChange={(e) => set({ to: e.target.value })} />
        </label>
        <label className="text-sm font-semibold text-navy">
          {an.scopeLabel}
          <select className={cn(input, "mt-1")} value={filter.scope} onChange={(e) => set({ scope: e.target.value as AnalyticsFilter["scope"] })}>
            {SCOPES.map((s) => <option key={s} value={s}>{an.scopes[s]}</option>)}
          </select>
        </label>
        <div className="flex flex-wrap items-center gap-2 sm:col-span-2 lg:col-span-5">
          {filtered && <button type="button" className="btn btn-outline btn-sm" onClick={() => setFilter(NO_ANALYTICS_FILTER)}>{an.reset}</button>}
          <span className="flex-1" />
          <button type="button" disabled={exporting || loading || !data} className="btn btn-primary btn-sm" onClick={() => exportReport("xlsx")}>{an.exportExcel}</button>
          <button type="button" disabled={exporting || loading || !data} className="btn btn-outline btn-sm" onClick={() => exportReport("csv")}>{an.exportCsv}</button>
        </div>
      </div>

      {error && <Notice tone="error">{error}</Notice>}
      <Tabs value={section} onChange={setSection} items={SECTIONS.map((s) => [s, an.sections[s]])} />
      {loading && <Spinner />}
      {!loading && data && (
        <>
          {section === "overview" && <Overview r={data} locale={locale} labels={labels} />}
          {section === "questions" && <Questions r={data} programId={course.programId} filter={filter} locale={locale} labels={labels} />}
          {section === "exams" && <Exams r={data} locale={locale} labels={labels} />}
          {section === "learners" && <Learners r={data} labels={labels} onPick={(id) => { set({ memberId: id }); setSection("overview"); }} />}
          {section === "attempts" && <Attempts r={data} locale={locale} labels={labels} />}
          {section === "mistakes" && <Mistakes r={data} programId={course.programId} locale={locale} labels={labels} />}
          {section === "security" && <Security r={data} locale={locale} labels={labels} />}
        </>
      )}
    </div>
  );
}

function Overview({ r, locale, labels }: { r: CourseReport; locale: string; labels: ExamLabels }) {
  const an = labels.analytics;
  const s = r.summary;
  const excluded: [number, string][] = [[s.pendingGrading, an.pendingGrading], [s.inProgress, an.inProgress], [s.underReview, an.underReview], [s.cancelled, an.cancelled]];
  if (s.attempts === 0 && s.cancelled === 0) return <Notice>{an.noAttempts}</Notice>;
  const period = (p: string) => (r.trend.unit === "month" ? p.slice(0, 7) : p.slice(5));
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label={an.countedAttempts} value={s.counted} hint={`${an.allAttempts}: ${s.attempts}`} />
        <Stat label={an.learnersCount} value={s.learners} />
        <Stat label={an.avg} value={pct(s.avgPercent)} hint={`${an.median}: ${pct(s.medianPercent)}`} />
        <Stat label={an.passRate} value={pct(s.passRate)} hint={an.passedOf.replace("{n}", String(s.passed)).replace("{of}", String(s.graded))} />
        <Stat label={an.max} value={pct(s.maxPercent)} />
        <Stat label={an.min} value={pct(s.minPercent)} />
        <Stat label={an.avgMinutes} value={s.avgMinutes ?? "—"} />
        <Stat label={an.improvementStat} value={s.counted && r.improvement.avgChange !== null ? `${r.improvement.avgChange > 0 ? "+" : ""}${r.improvement.avgChange}` : "—"} hint={an.pairs.replace("{n}", String(r.improvement.pairs))} />
      </div>
      {excluded.some(([n]) => n > 0) && (
        <Notice>
          {an.excluded} {excluded.filter(([n]) => n > 0).map(([n, l]) => `${l}: ${n}`).join(" · ")}
        </Notice>
      )}
      <p className="text-xs text-slate">{an.countedHint}</p>
      {s.counted > 0 && (
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="card p-5">
            <h3 className="font-bold text-navy">{an.distribution}</h3>
            <p className="mb-2 text-xs text-slate">{an.distributionHint}</p>
            <Columns label={an.distribution} data={r.distribution.map((b) => ({ key: String(b.from), label: String(b.from), value: b.count, tip: `${b.from}–${b.to}%: ${b.count}` }))} />
          </div>
          <div className="card p-5">
            <h3 className="font-bold text-navy">{an.trend}</h3>
            <p className="mb-2 text-xs text-slate">{r.trend.unit === "month" ? an.trendMonth : an.trendDay}</p>
            {r.trend.points.length < 2 ? (
              <p className="text-sm text-slate">
                {an.trendOne}
                {r.trend.points[0] && <> <bdi dir="ltr">{r.trend.points[0].period.slice(0, 10)}</bdi>: {pct(r.trend.points[0].avgPercent)} ({r.trend.points[0].attempts})</>}
              </p>
            ) : (
              <Columns
                label={an.trend}
                max={100}
                format={(v) => `${Math.round(v)}%`}
                data={r.trend.points.slice(-31).map((p) => ({ key: p.period, label: period(p.period), value: p.avgPercent ?? 0, tip: `${p.period}: ${pct(p.avgPercent)} (${p.attempts})` }))}
              />
            )}
          </div>
        </div>
      )}
      {s.counted > 0 && <Breakdowns data={r} locale={locale} labels={labels} />}
    </div>
  );
}

type Sort = "hardest" | "wrong" | "unanswered" | "asked";

function Questions({ r, programId, filter, locale, labels }: { r: CourseReport; programId: string; filter: AnalyticsFilter; locale: string; labels: ExamLabels }) {
  const an = labels.analytics;
  const c = an.cols;
  const ar = locale === "ar";
  const [sort, setSort] = useState<Sort>("hardest");
  const [flaggedOnly, setFlaggedOnly] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [shown, setShown] = useState(50);
  const by: Record<Sort, (a: QuestionStat, b: QuestionStat) => number> = {
    hardest: (a, b) => (a.facility ?? 101) - (b.facility ?? 101) || b.asked - a.asked,
    wrong: (a, b) => b.wrong - a.wrong || (a.facility ?? 101) - (b.facility ?? 101),
    unanswered: (a, b) => b.unanswered - a.unanswered,
    asked: (a, b) => b.asked - a.asked,
  };
  const rows = r.questions.filter((q) => !flaggedOnly || questionFlags(q).length > 0).sort(by[sort]);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm font-semibold text-navy">
          {an.sortBy}
          <select className="field w-auto" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
            {(Object.keys(by) as Sort[]).map((k) => <option key={k} value={k}>{an.sorts[k]}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm text-navy">
          <input type="checkbox" checked={flaggedOnly} onChange={(e) => setFlaggedOnly(e.target.checked)} />
          {an.flaggedOnly}
        </label>
        <span className="text-sm text-slate">{rows.length}</span>
      </div>
      <p className="text-xs text-slate">{an.itemHint}</p>
      <Table head={[c.question, c.asked, c.correct, c.wrong, c.unanswered, c.facility, c.discrimination, ""]} count={rows.length} empty={an.noData}>
        {rows.slice(0, shown).map((q) => (
          <Fragment key={q.questionId}>
            <tr>
              <td className={cn(TD, "min-w-64 max-w-md")}>
                <span className="line-clamp-2">{ar ? q.stemAr || q.stemEn : q.stemEn || q.stemAr}</span>
                <span className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-slate">
                  {labels.bank.types[q.type]}
                  {q.versions > 1 && <span>· {an.versions.replace("{n}", String(q.versions))}</span>}
                  {questionFlags(q).map((f) => (
                    <span key={f} className={cn("rounded-md px-1.5 py-0.5 font-semibold", f === "easy" ? "bg-mist text-navy" : "bg-gold/15 text-gold-600")}>
                      ⚠ {an.flags[f]}
                    </span>
                  ))}
                </span>
              </td>
              <td className={TD}>{q.asked}</td>
              <td className={TD}>{q.correct}</td>
              <td className={TD}>{q.wrong}</td>
              <td className={TD}>{q.unanswered}</td>
              <td className={cn(TD, "font-bold")} dir="ltr">{pct(q.facility)}</td>
              <td className={TD} dir="ltr">{q.discrimination ?? "—"}</td>
              <td className={TD}>
                <button type="button" aria-expanded={open === q.questionId} onClick={() => setOpen(open === q.questionId ? null : q.questionId)} className="whitespace-nowrap text-xs font-semibold text-brand hover:underline">
                  {open === q.questionId ? an.hide : an.details}
                </button>
              </td>
            </tr>
            {open === q.questionId && (
              <tr>
                <td colSpan={8} className="bg-mist/50 px-4 py-3">
                  <QuestionDetail programId={programId} questionId={q.questionId} filter={filter} locale={locale} labels={labels} />
                </td>
              </tr>
            )}
          </Fragment>
        ))}
      </Table>
      {rows.length > shown && <button type="button" onClick={() => setShown(shown + 100)} className="btn btn-outline btn-sm">{an.more}</button>}
    </div>
  );
}

function QuestionDetail({ programId, questionId, filter, locale, labels }: { programId: string; questionId: string; filter: AnalyticsFilter; locale: string; labels: ExamLabels }) {
  const an = labels.analytics;
  const ar = locale === "ar";
  const [d, setD] = useState<QuestionAnalysis | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    setError(null);
    rpc<QuestionAnalysis>("exam_analytics_question", { p_program: programId, p_question: questionId, p_filter: rpcFilter(filter) })
      .then(setD)
      .catch((e) => setError(errorText(e, labels)));
  }, [programId, questionId, filter, labels]);
  useEffect(load, [load]);
  if (error) return <Notice tone="error">{error}</Notice>;
  if (!d) return <Spinner />;
  const share = (n: number) => (d.asked ? (100 * n) / d.asked : 0);
  const row = (key: string, label: string, n: number, good = false) => ({ key, label, value: share(n), text: `${n} (${Math.round(share(n))}%)`, tone: good ? ("good" as const) : ("plain" as const) });
  return (
    <div className="space-y-4">
      <p className="whitespace-pre-line text-sm font-semibold leading-7 text-navy">{ar ? d.stemAr || d.stemEn : d.stemEn || d.stemAr}</p>
      <div className="grid gap-6 lg:grid-cols-2">
        <div>
          <h4 className="mb-2 text-sm font-bold text-navy">{an.outcomes}</h4>
          <Bars empty={an.noData} rows={[row("full", an.outcome.full, d.results.full, true), ...(d.results.partial ? [row("partial", an.outcome.partial, d.results.partial)] : []), row("zero", an.outcome.zero, d.results.zero), row("unanswered", an.outcome.unanswered, d.results.unanswered)]} />
        </div>
        {d.options && (
          <div>
            <h4 className="mb-2 text-sm font-bold text-navy">{an.choices}</h4>
            <Bars
              empty={an.noData}
              rows={d.options.map((o) => {
                const text = d.type === "TRUE_FALSE" ? (o.id === "true" ? labels.bank.editor.tfTrue : labels.bank.editor.tfFalse) : (ar ? o.textAr || o.textEn : o.textEn || o.textAr) || o.id;
                return row(o.id, o.correct ? `✓ ${text} — ${an.correctChoice}` : text, o.count, o.correct);
              })}
            />
          </div>
        )}
        {d.answers && (
          <div>
            <h4 className="mb-2 text-sm font-bold text-navy">{an.typed}</h4>
            <Bars empty={an.noData} rows={d.answers.map((a, i) => row(String(i), a.correct ? `✓ ${a.text}` : a.text, a.count, a.correct))} />
          </div>
        )}
      </div>
    </div>
  );
}

function Exams({ r, locale, labels }: { r: CourseReport; locale: string; labels: ExamLabels }) {
  const an = labels.analytics;
  const c = an.cols;
  const im = r.improvement;
  return (
    <div className="space-y-6">
      <Table head={[c.exam, c.attempts, c.learners, c.avg, c.min, c.max, c.passRate, c.minutes, c.timedOut, ""]} count={r.exams.length} empty={an.noData}>
        {r.exams.map((e) => (
          <tr key={e.examId}>
            <td className={cn(TD, "font-semibold text-navy")}>{title(e, locale)}</td>
            <td className={TD}>{e.attempts} <span className="text-xs text-slate">({an.cols.counted}: {e.counted})</span></td>
            <td className={TD}>{e.learners}</td>
            <td className={cn(TD, "font-bold")} dir="ltr">{pct(e.avgPercent)}</td>
            <td className={TD} dir="ltr">{pct(e.minPercent)}</td>
            <td className={TD} dir="ltr">{pct(e.maxPercent)}</td>
            <td className={TD} dir="ltr">{pct(e.passRate)}</td>
            <td className={TD}>{e.avgMinutes ?? "—"}</td>
            <td className={TD}>{e.timedOut}</td>
            <td className={TD}><Link href={`/${locale}/exams/attempts?id=${encodeURIComponent(e.examId)}`} className="whitespace-nowrap text-xs font-semibold text-brand hover:underline">{labels.staffAttempts.open}</Link></td>
          </tr>
        ))}
      </Table>
      <div>
        <h3 className="font-bold text-navy">{an.improvement}</h3>
        <p className="mt-1 text-xs text-slate">{an.improvementHint}</p>
        {im.pairs > 0 && (
          <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label={an.improved} value={`${im.improved} / ${im.pairs}`} />
            <Stat label={an.declined} value={im.declined} />
            <Stat label={an.firstToLast} value={`${pct(im.avgFirst)} → ${pct(im.avgLast)}`} />
            <Stat label={an.avgChange} value={im.avgChange === null ? "—" : `${im.avgChange > 0 ? "+" : ""}${im.avgChange}`} />
          </div>
        )}
      </div>
      <Table head={[c.learner, c.exam, c.attempts, c.first, c.last, c.best, c.change]} count={im.rows.length} empty={an.noImprovement}>
        {im.rows.map((x) => (
          <tr key={x.memberId + x.examId}>
            <td className={TD}><Person name={x.name} email={x.email} /></td>
            <td className={TD}>{title(x, locale)}</td>
            <td className={TD}>{x.attempts}</td>
            <td className={TD} dir="ltr">{pct(x.first)}</td>
            <td className={TD} dir="ltr">{pct(x.last)}</td>
            <td className={TD} dir="ltr">{pct(x.best)}</td>
            <td className={cn(TD, "font-bold", x.change > 0 ? "text-emerald-700" : x.change < 0 ? "text-gold-600" : "")} dir="ltr">{x.change > 0 ? `▲ +${x.change}` : x.change < 0 ? `▼ ${x.change}` : "0"}</td>
          </tr>
        ))}
      </Table>
    </div>
  );
}

function Learners({ r, labels, onPick }: { r: CourseReport; labels: ExamLabels; onPick: (id: string) => void }) {
  const an = labels.analytics;
  const c = an.cols;
  return (
    <Table head={[c.learner, c.attempts, c.exams, c.examsPassed, c.avg, c.best, c.last, c.warnings, ""]} count={r.learners.length} empty={an.noData}>
      {r.learners.map((l) => (
        <tr key={l.memberId}>
          <td className={TD}><Person name={l.name} email={l.email} /></td>
          <td className={TD}>{l.attempts}</td>
          <td className={TD}>{l.exams}</td>
          <td className={TD}>{l.examsPassed}</td>
          <td className={cn(TD, "font-bold")} dir="ltr">{pct(l.avgPercent)}</td>
          <td className={TD} dir="ltr">{pct(l.bestPercent)}</td>
          <td className={TD} dir="ltr">{pct(l.lastPercent)}</td>
          <td className={TD}>{l.warnings}</td>
          <td className={TD}><button type="button" onClick={() => onPick(l.memberId)} className="whitespace-nowrap text-xs font-semibold text-brand hover:underline">{an.learnerReport}</button></td>
        </tr>
      ))}
    </Table>
  );
}

function Attempts({ r, locale, labels }: { r: CourseReport; locale: string; labels: ExamLabels }) {
  const an = labels.analytics;
  const c = an.cols;
  const statuses = labels.take.statuses;
  const [shown, setShown] = useState(50);
  return (
    <div className="space-y-3">
      <Table head={[c.learner, c.exam, c.status, c.started, c.minutes, c.percent, c.correct, c.wrong, c.unanswered, c.flagged, c.warnings]} count={r.attemptsList.length} empty={an.noData}>
        {r.attemptsList.slice(0, shown).map((a) => (
          <tr key={a.id}>
            <td className={TD}><Person name={a.name} email={a.email} /></td>
            <td className={TD}>
              <Link href={`/${locale}/exams/attempts?id=${encodeURIComponent(a.examId)}`} className="text-brand hover:underline">{title(a, locale)}</Link>
              <span className="block text-xs text-slate">#{a.attemptNo}</span>
            </td>
            <td className={TD}>
              {statuses[a.status as keyof typeof statuses] ?? a.status}
              {a.needsManual && a.status !== "SUBMITTED" && <span className="block text-xs text-slate">{an.pendingGrading}</span>}
            </td>
            <td className={cn(TD, "whitespace-nowrap")}>{localWhen(a.startedAt, locale)}</td>
            <td className={TD}>{a.minutes ?? "—"}</td>
            <td className={cn(TD, "font-bold")} dir="ltr">{a.needsManual ? "—" : pct(a.percent)}{a.passed !== null && <span aria-label={a.passed ? an.passedWord : an.failedWord}> {a.passed ? "✓" : "✗"}</span>}</td>
            <td className={TD}>{a.correct}</td>
            <td className={TD}>{a.wrong}</td>
            <td className={TD}>{a.unanswered}</td>
            <td className={TD}>{a.flagged}</td>
            <td className={TD}>{a.warnings}</td>
          </tr>
        ))}
      </Table>
      {r.attemptsList.length > shown && <button type="button" onClick={() => setShown(shown + 200)} className="btn btn-outline btn-sm">{an.more}</button>}
    </div>
  );
}

function Mistakes({ r, programId, locale, labels }: { r: CourseReport; programId: string; locale: string; labels: ExamLabels }) {
  const an = labels.analytics;
  const m = r.mistakes;
  const reviews = Number(m.reviewCorrect) + Number(m.reviewWrong);
  const share = (n: number) => (m.total ? (100 * n) / m.total : 0);
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label={an.mistakeTotal} value={m.total} hint={`${an.learnersCount}: ${m.learners}`} />
        <Stat label={an.wrongTotal} value={m.wrongTotal} />
        <Stat label={an.sessions} value={m.sessions} />
        <Stat label={an.reviewAccuracy} value={reviews ? pct((100 * Number(m.reviewCorrect)) / reviews) : "—"} hint={`✓ ${m.reviewCorrect} · ✗ ${m.reviewWrong}`} />
      </div>
      {m.total > 0 && (
        <div className="card p-5">
          <h3 className="mb-3 font-bold text-navy">{an.mistakeStatus}</h3>
          <Bars
            empty={an.noData}
            rows={[
              { key: "mastered", label: an.mastered, value: share(m.mastered), text: `${m.mastered} (${Math.round(share(m.mastered))}%)`, tone: "good" },
              { key: "review", label: an.beingReviewed, value: share(m.inProgress), text: `${m.inProgress} (${Math.round(share(m.inProgress))}%)` },
              { key: "wrong", label: an.stillWrong, value: share(m.stillWrong), text: `${m.stillWrong} (${Math.round(share(m.stillWrong))}%)` },
            ]}
          />
        </div>
      )}
      <Link href={`/${locale}/exams/mistakes?id=${encodeURIComponent(programId)}`} className="btn btn-outline btn-sm">{an.mistakesDetail}</Link>
    </div>
  );
}

function Security({ r, locale, labels }: { r: CourseReport; locale: string; labels: ExamLabels }) {
  const an = labels.analytics;
  const c = an.cols;
  const kind = (k: string) => labels.proctor.events[k as keyof ExamLabels["proctor"]["events"]] ?? k;
  const [shown, setShown] = useState(50);
  return (
    <div className="space-y-5">
      <Stat label={an.attemptsWithWarnings} value={r.security.attemptsWithWarnings} />
      <Table heading={an.eventsByKind} head={[c.event, an.events, c.countedWarning, c.attempts]} count={r.security.byKind.length} empty={an.noEvents}>
        {r.security.byKind.map((k) => (
          <tr key={k.kind}>
            <td className={TD}>{kind(k.kind)}</td>
            <td className={cn(TD, "font-bold")}>{k.events}</td>
            <td className={TD}>{k.counted}</td>
            <td className={TD}>{k.attempts}</td>
          </tr>
        ))}
      </Table>
      {r.security.events.length > 0 && (
        <Table heading={an.eventLog} head={[c.time, c.event, c.learner, c.exam]} count={r.security.events.length} empty={an.noEvents}>
          {r.security.events.slice(0, shown).map((e, i) => (
            <tr key={`${e.attemptId}-${e.at}-${i}`}>
              <td className={cn(TD, "whitespace-nowrap")}>{localWhen(e.at, locale)}</td>
              <td className={TD}>{kind(e.kind)}{e.counted && <span className="ms-1 rounded-md bg-gold/15 px-1.5 py-0.5 text-xs font-semibold text-gold-600">{c.countedWarning}</span>}</td>
              <td className={TD}><Person name={e.name} email={e.email} /></td>
              <td className={TD}>{title(e, locale)}</td>
            </tr>
          ))}
        </Table>
      )}
      {r.security.events.length > shown && <button type="button" onClick={() => setShown(shown + 200)} className="btn btn-outline btn-sm">{an.more}</button>}
    </div>
  );
}

// ── my own report ──

function MyReportView({ programId, courses, locale, labels }: { programId: string | null; courses: ExamCourse[]; locale: string; labels: ExamLabels }) {
  const an = labels.analytics;
  const c = an.cols;
  const [course, setCourse] = useState(programId ?? "");
  const [data, setData] = useState<MyReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setData(null);
    setError(null);
    rpc<MyReport>("exam_analytics_me", { p_program: course || null })
      .then((d) => live && setData(d))
      .catch((e) => live && setError(errorText(e, labels)));
    return () => {
      live = false;
    };
  }, [course, labels]);

  const exportMine = (kind: "xlsx" | "csv") => {
    if (!data) return;
    const attempts: Sheet = {
      name: an.sections.attempts,
      rows: [[c.exam, c.attemptNo, c.started, c.percent, c.passed], ...data.exams.flatMap((e) => e.attempts.map((a) => [title(e, locale), a.attemptNo, when(a.at), a.percent, a.passed === null ? "" : a.passed ? an.yes : an.no]))],
    };
    if (kind === "csv") download(`my-report-${stamp()}.csv`, toCsv(attempts.rows), "text/csv;charset=utf-8");
    else
      download(
        `my-report-${stamp()}.xlsx`,
        toXlsx(
          [attempts, breakdownSheet(an.byDomain, data.domains, "domainId", locale, labels), breakdownSheet(an.byTopic, data.topics, "topicId", locale, labels), breakdownSheet(an.byType, data.types, "type", locale, labels), breakdownSheet(an.byDifficulty, data.difficulties, "difficulty", locale, labels)],
          locale === "ar",
        ) as BlobPart,
        XLSX_MIME,
      );
  };

  const s = data?.summary;
  const m = data?.mistakes;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-3">
        {courses.length > 1 && (
          <label className="text-sm font-semibold text-navy">
            {an.course}
            <select className="field mt-1 block w-auto max-w-full" value={course} onChange={(e) => setCourse(e.target.value)}>
              <option value="">{an.allCourses}</option>
              {courses.map((x) => <option key={x.programId} value={x.programId}>{courseTitle(x, locale)}</option>)}
            </select>
          </label>
        )}
        <span className="flex-1" />
        <button type="button" disabled={!data || !data.exams.length} onClick={() => exportMine("xlsx")} className="btn btn-primary btn-sm">{an.exportExcel}</button>
        <button type="button" disabled={!data || !data.exams.length} onClick={() => exportMine("csv")} className="btn btn-outline btn-sm">{an.exportCsv}</button>
      </div>
      {error && <Notice tone="error">{error}</Notice>}
      {!data && !error && <Spinner />}
      {data && s && m && (
        <>
          {s.waiting > 0 && <Notice>{an.waiting.replace("{n}", String(s.waiting))}</Notice>}
          {s.released === 0 ? (
            <Notice>{an.mineEmpty}</Notice>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <Stat label={an.myAttempts} value={s.released} hint={`${an.allAttempts}: ${s.attempts}`} />
                <Stat label={an.avg} value={pct(s.avgPercent)} />
                <Stat label={an.bestResult} value={pct(s.bestPercent)} />
                <Stat label={an.examsPassed} value={`${s.examsPassed} / ${s.exams}`} />
              </div>
              <div>
                <h2 className="text-xl font-bold">{an.progress}</h2>
                <ul className="mt-3 grid gap-5 lg:grid-cols-2">
                  {data.exams.map((e) => (
                    <li key={e.examId} className="card p-5">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <h3 className="font-bold text-navy">{title(e, locale)}</h3>
                        <span className={cn("rounded-md px-2 py-0.5 text-xs font-semibold", e.passed ? "bg-emerald-50 text-emerald-700" : "bg-gold/15 text-gold-600")}>{e.passed ? `✓ ${an.passedWord}` : `✗ ${an.notPassed}`}</span>
                      </div>
                      <p className="mt-1 text-xs text-slate">
                        {an.passMark}: {pct(Number(e.passPercent))}
                        {e.change !== null && <> · {an.firstToLast}: <bdi dir="ltr">{pct(e.first)} → {pct(e.last)} ({e.change > 0 ? "+" : ""}{e.change})</bdi></>}
                      </p>
                      <Columns label={title(e, locale)} max={100} format={(v) => `${Math.round(v)}%`} data={e.attempts.slice(-20).map((a) => ({ key: a.id, label: `#${a.attemptNo}`, value: a.percent ?? 0, tip: `#${a.attemptNo}: ${pct(a.percent)}` }))} />
                      <ul className="mt-3 flex flex-wrap gap-2 text-xs">
                        {e.attempts.map((a) => (
                          <li key={a.id}>
                            <Link href={`/${locale}/exams/review?id=${encodeURIComponent(a.id)}`} className="inline-block rounded-md bg-mist px-2 py-1 font-semibold text-brand hover:underline" dir="ltr">
                              #{a.attemptNo} · {pct(a.percent)}
                            </Link>
                          </li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ul>
              </div>
              <Breakdowns data={data} locale={locale} labels={labels} />
            </>
          )}
          {m.total > 0 && (
            <div className="card p-5">
              <h3 className="mb-3 font-bold text-navy">{an.myMistakes}</h3>
              <Bars
                empty={an.noData}
                rows={[{ key: "mastered", label: an.mastered, value: (100 * m.mastered) / m.total, text: `${m.mastered} / ${m.total}`, note: `${an.stillWrong}: ${m.stillWrong} · ${an.reviewCorrect}: ${m.reviewCorrect} · ${an.reviewWrong}: ${m.reviewWrong}`, tone: "good" }]}
              />
              {course && <Link href={`/${locale}/exams/mistakes?id=${encodeURIComponent(course)}`} className="btn btn-outline btn-sm mt-4">{labels.mistakes.open}</Link>}
            </div>
          )}
        </>
      )}
    </div>
  );
}
