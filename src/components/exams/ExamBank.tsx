"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { courseTitle, rpc, useExamSession, type ExamCourse } from "@/lib/exams/client";
import {
  bankErrorKey,
  catName,
  QUESTION_TYPES,
  stem,
  type BankOverview,
  type QuestionFull,
  type QuestionSummary,
} from "@/lib/exams/bank";
import { cn } from "@/lib/utils";
import { ExamShell, Notice, Spinner, type ExamLabels } from "./ExamShell";
import { BankCategories } from "./BankCategories";
import { QuestionEditor } from "./QuestionEditor";
import { QuestionPreview } from "./QuestionPreview";

/** /[locale]/exams/bank?id=… — one course's question bank (admins and that course's instructors only) */
export function ExamBank(props: { locale: string; labels: ExamLabels; homeLabel: string }) {
  return (
    <Suspense fallback={<Spinner />}>
      <BankInner {...props} />
    </Suspense>
  );
}

function BankInner({ locale, labels, homeLabel }: { locale: string; labels: ExamLabels; homeLabel: string }) {
  const id = useSearchParams().get("id") ?? "";
  const { state, reload } = useExamSession(locale);
  const course = state.status === "ready" ? state.me.courses.find((c) => c.programId === id) : undefined;
  const b = labels.bank;
  const staff = course && (course.access === "ADMIN" || course.access === "INSTRUCTOR");
  return (
    <ExamShell
      locale={locale}
      labels={labels}
      state={state}
      reload={reload}
      title={course ? `${b.title} · ${courseTitle(course, locale)}` : b.title}
      crumbs={[
        { href: `/${locale}`, label: homeLabel },
        { href: `/${locale}/exams`, label: labels.title },
        ...(course ? [{ href: `/${locale}/exams/course?id=${encodeURIComponent(course.programId)}`, label: course.code ?? courseTitle(course, locale) }] : []),
        { label: b.title },
      ]}
    >
      {() =>
        staff ? (
          <Bank course={course!} locale={locale} labels={labels} />
        ) : (
          <Notice tone="error">
            <p>{labels.course.notFound}</p>
            <Link href={`/${locale}/exams`} className="btn btn-outline btn-sm mt-3">{labels.course.back}</Link>
          </Notice>
        )
      }
    </ExamShell>
  );
}

type View = { kind: "list" } | { kind: "edit"; q: QuestionFull | null } | { kind: "preview"; q: QuestionFull };
type Filter = { q: string; type: string; status: string; difficulty: string; categoryId: string; page: number };
const PAGE = 20;

function Bank({ course, locale, labels }: { course: ExamCourse; locale: string; labels: ExamLabels }) {
  const b = labels.bank;
  const [overview, setOverview] = useState<BankOverview | null>(null);
  const [tab, setTab] = useState<"questions" | "categories">("questions");
  const [view, setView] = useState<View>({ kind: "list" });
  const [filter, setFilter] = useState<Filter>({ q: "", type: "", status: "", difficulty: "", categoryId: "", page: 1 });
  const [list, setList] = useState<{ total: number; items: QuestionSummary[] } | null>(null);
  const [flash, setFlash] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [failed, setFailed] = useState(false);

  const loadOverview = useCallback(async () => {
    try {
      setOverview(await rpc<BankOverview>("exam_bank_overview", { p_program: course.programId }));
    } catch {
      setFailed(true);
    }
  }, [course.programId]);

  const loadList = useCallback(async (f: Filter) => {
    try {
      const r = await rpc<{ total: number; items: QuestionSummary[] }>("exam_bank_questions", { p_program: course.programId, p_filter: { ...f, pageSize: PAGE } });
      setList(r);
    } catch {
      setFailed(true);
    }
  }, [course.programId]);

  useEffect(() => { loadOverview(); }, [loadOverview]);
  useEffect(() => {
    const t = setTimeout(() => loadList(filter), filter.q ? 300 : 0);
    return () => clearTimeout(t);
  }, [filter, loadList]);

  const refresh = async () => { await Promise.all([loadOverview(), loadList(filter)]); };
  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setFlash(null);
    try {
      await fn();
      setFlash({ tone: "success", text: ok });
      await refresh();
    } catch (e) {
      setFlash({ tone: "error", text: (b.errors as Record<string, string>)[bankErrorKey(e)] ?? labels.errorGeneric });
    }
  };
  const open = async (qid: string, kind: "edit" | "preview") => {
    try {
      const q = await rpc<QuestionFull>("exam_bank_question", { p_id: qid });
      setView(kind === "edit" ? { kind, q } : { kind, q });
    } catch (e) {
      setFlash({ tone: "error", text: (b.errors as Record<string, string>)[bankErrorKey(e)] ?? labels.errorGeneric });
    }
  };

  if (failed) return <Notice tone="error">{labels.errorGeneric}</Notice>;
  if (!overview) return <Spinner />;
  const cats = overview.categories;
  const can = overview.can;
  const catLabel = (q: QuestionSummary) => [q.domainId, q.topicId, q.subtopicId].map((cid) => cats.find((c) => c.id === cid)).filter(Boolean).map((c) => catName(c!, locale)).join(" › ");

  if (view.kind === "edit")
    return (
      <QuestionEditor
        programId={course.programId}
        initial={view.q}
        categories={cats}
        locale={locale}
        labels={labels}
        onCancel={() => setView({ kind: "list" })}
        onSaved={async () => {
          setView({ kind: "list" });
          setFlash({ tone: "success", text: b.saved });
          await refresh();
        }}
      />
    );

  if (view.kind === "preview")
    return (
      <div className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-2xl font-bold">
            {b.preview} · {b.types[view.q.type]} · {b.version}{view.q.version}
          </h2>
          <div className="flex gap-2">
            {can.edit && <button type="button" onClick={() => setView({ kind: "edit", q: view.q })} className="btn btn-primary btn-sm">{b.edit}</button>}
            <button type="button" onClick={() => setView({ kind: "list" })} className="btn btn-outline btn-sm">{b.editor.cancel}</button>
          </div>
        </div>
        <QuestionPreview q={view.q} locale={locale} labels={labels} />
      </div>
    );

  const pages = Math.max(1, Math.ceil((list?.total ?? 0) / PAGE));
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1 rounded-xl border border-line bg-mist p-1" role="tablist">
          {(["questions", "categories"] as const).map((t) => (
            <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={cn("rounded-lg px-4 py-2 text-sm font-semibold transition", tab === t ? "bg-white text-navy shadow-sm" : "text-slate hover:text-navy")}>
              {b.tabs[t]}
              {t === "questions" && <span className="ms-1.5 text-slate">({overview.counts.total})</span>}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href={`/${locale}/exams/course?id=${encodeURIComponent(course.programId)}`} className="btn btn-outline btn-sm">{b.back}</Link>
          {can.edit && tab === "questions" && (
            <button type="button" onClick={() => setView({ kind: "edit", q: null })} className="btn btn-primary btn-sm">+ {b.newQuestion}</button>
          )}
        </div>
      </div>

      {flash && <Notice tone={flash.tone}>{flash.text}</Notice>}
      {!can.edit && <Notice>{b.readOnly}</Notice>}

      {tab === "categories" ? (
        <BankCategories programId={course.programId} categories={cats} canManage={can.categories} locale={locale} labels={labels} onChanged={loadOverview} />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
            <input type="search" value={filter.q} onChange={(e) => setFilter({ ...filter, q: e.target.value, page: 1 })} placeholder={b.search} className="field lg:col-span-2" />
            <select value={filter.type} onChange={(e) => setFilter({ ...filter, type: e.target.value, page: 1 })} className="field">
              <option value="">{b.allTypes}</option>
              {QUESTION_TYPES.map((t) => <option key={t} value={t}>{b.types[t]}</option>)}
            </select>
            <select value={filter.status} onChange={(e) => setFilter({ ...filter, status: e.target.value, page: 1 })} className="field">
              <option value="">{b.allStatuses}</option>
              {(["DRAFT", "ACTIVE", "DISABLED"] as const).map((s) => <option key={s} value={s}>{b.statuses[s]}</option>)}
            </select>
            <select value={filter.difficulty} onChange={(e) => setFilter({ ...filter, difficulty: e.target.value, page: 1 })} className="field">
              <option value="">{b.allDifficulties}</option>
              {(["EASY", "MEDIUM", "HARD"] as const).map((d) => <option key={d} value={d}>{b.difficulties[d]}</option>)}
            </select>
            <select value={filter.categoryId} onChange={(e) => setFilter({ ...filter, categoryId: e.target.value, page: 1 })} className="field">
              <option value="">{b.allCategories}</option>
              {cats.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.kind === "DOMAIN" ? "" : c.kind === "TOPIC" ? "— " : "—— "}
                  {catName(c, locale)}
                </option>
              ))}
            </select>
          </div>

          {!list ? <Spinner /> : list.items.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-line bg-mist/60 px-6 py-10 text-center text-slate">{overview.counts.total === 0 ? b.emptyBank : b.noQuestions}</p>
          ) : (
            <ul className="space-y-3">
              {list.items.map((q) => (
                <li key={q.id} className={cn("card p-4 sm:p-5", q.status === "DISABLED" && "opacity-70")}>
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="rounded-md bg-navy px-2 py-0.5 font-semibold text-white">{b.types[q.type]}</span>
                    <span className={cn("rounded-md px-2 py-0.5 font-semibold", q.status === "ACTIVE" ? "bg-emerald-50 text-emerald-700" : q.status === "DRAFT" ? "bg-sky-50 text-navy" : "bg-gold/10 text-gold-600")}>{b.statuses[q.status]}</span>
                    <span className="rounded-md bg-mist px-2 py-0.5 text-slate">{b.difficulties[q.difficulty]}</span>
                    <span className="text-slate" dir="ltr">{Number(q.points)} pt · w{Number(q.weight)} · {b.version}{q.version}</span>
                    {catLabel(q) && <span className="text-slate">· {catLabel(q)}</span>}
                  </div>
                  <p className="mt-2 line-clamp-2 leading-7 text-navy">{stem(q, locale)}</p>
                  <div className="mt-3 flex flex-wrap gap-1.5 text-sm">
                    <button type="button" onClick={() => open(q.id, "preview")} className="rounded-lg px-2.5 py-1 font-semibold text-brand hover:bg-brand/10">{b.preview}</button>
                    {can.edit && (
                      <>
                        <button type="button" onClick={() => open(q.id, "edit")} className="rounded-lg px-2.5 py-1 font-semibold text-brand hover:bg-brand/10">{b.edit}</button>
                        <button type="button" onClick={() => act(() => rpc("exam_bank_question_copy", { p_id: q.id }), b.copied)} className="rounded-lg px-2.5 py-1 text-slate hover:bg-mist">{b.copy}</button>
                        <button type="button" onClick={() => act(() => rpc("exam_bank_question_set_status", { p_id: q.id, p_status: q.status === "DISABLED" ? "ACTIVE" : "DISABLED" }), b.saved)} className="rounded-lg px-2.5 py-1 text-slate hover:bg-mist">
                          {q.status === "DISABLED" ? b.activate : b.disable}
                        </button>
                      </>
                    )}
                    {can.delete && (
                      <button type="button" onClick={() => window.confirm(b.confirmDelete) && act(() => rpc("exam_bank_question_delete", { p_id: q.id }), b.deleted)} className="rounded-lg px-2.5 py-1 text-gold-600 hover:bg-gold/10">{b.delete}</button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}

          {pages > 1 && (
            <div className="flex items-center justify-center gap-3 text-sm">
              <button type="button" disabled={filter.page <= 1} onClick={() => setFilter({ ...filter, page: filter.page - 1 })} className="btn btn-outline btn-sm">{b.prev}</button>
              <span className="text-slate">{b.pageOf.replace("{p}", String(filter.page)).replace("{n}", String(pages))}</span>
              <button type="button" disabled={filter.page >= pages} onClick={() => setFilter({ ...filter, page: filter.page + 1 })} className="btn btn-outline btn-sm">{b.next}</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
