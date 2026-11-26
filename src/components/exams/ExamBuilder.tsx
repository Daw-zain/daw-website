"use client";

import { Suspense, useCallback, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { courseTitle, rpc, useExamSession, type ExamCourse } from "@/lib/exams/client";
import { catName, QUESTION_TYPES, stem, title, type BankOverview, type QuestionFull, type QuestionSummary, type ScenarioFull, type ScenarioSummary } from "@/lib/exams/bank";
import { blankExam, blankRule, examErrorKey, fromLocalInput, issueText, toLocalInput, toSaveExam, type ExamFull, type ExamRuleRow } from "@/lib/exams/builder";
import { cn } from "@/lib/utils";
import { ExamShell, Notice, Spinner, type ExamLabels } from "./ExamShell";
import { QuestionPreview } from "./QuestionPreview";
import { statusClass } from "./ExamFolderPage";

const Field = ({ label, children, className = "" }: { label: string; children: ReactNode; className?: string }) => (
  <label className={`block text-sm ${className}`}>
    <span className="field-label">{label}</span>
    {children}
  </label>
);
const Toggle = ({ label, checked, onChange, disabled }: { label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) => (
  <label className="flex items-center gap-2 text-sm text-ink">
    <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} disabled={disabled} className="h-4 w-4 accent-[var(--color-brand)]" />
    {label}
  </label>
);
const Section = ({ title: t, children }: { title: string; children: ReactNode }) => (
  <section className="card space-y-4 p-5 sm:p-6">
    <h2 className="text-lg font-bold text-navy">{t}</h2>
    {children}
  </section>
);

/** /[locale]/exams/exam?id=… (edit) or ?folder=… (new) */
export function ExamBuilder(props: { locale: string; labels: ExamLabels; homeLabel: string }) {
  return (
    <Suspense fallback={<Spinner />}>
      <Inner {...props} />
    </Suspense>
  );
}

function Inner({ locale, labels, homeLabel }: { locale: string; labels: ExamLabels; homeLabel: string }) {
  const params = useSearchParams();
  const examId = params.get("id") ?? "";
  const folderId = params.get("folder") ?? "";
  const { state, reload } = useExamSession(locale);
  const [exam, setExam] = useState<ExamFull | null>(null);
  const [failed, setFailed] = useState(false);
  const bl = labels.builder;

  useEffect(() => {
    if (state.status !== "ready") return;
    if (examId) rpc<ExamFull>("exam_exam_get", { p_id: examId }).then(setExam).catch(() => setFailed(true));
    else if (folderId)
      rpc<{ folder: { id: string; kind: string; programId: string }; canEdit: boolean }>("exam_folder_exams", { p_folder: folderId })
        .then((f) => (f.canEdit ? setExam({ ...blankExam(f.folder.id, f.folder.kind), programId: f.folder.programId, canEdit: true }) : setFailed(true)))
        .catch(() => setFailed(true));
  }, [state.status, examId, folderId]);

  const course = state.status === "ready" && exam ? state.me.courses.find((c) => c.programId === exam.programId) : undefined;
  return (
    <ExamShell
      locale={locale}
      labels={labels}
      state={state}
      reload={reload}
      title={exam?.id ? title(exam, locale) || bl.titleEdit : bl.titleNew}
      text={course ? courseTitle(course, locale) : undefined}
      crumbs={[
        { href: `/${locale}`, label: homeLabel },
        { href: `/${locale}/exams`, label: labels.title },
        ...(course ? [{ href: `/${locale}/exams/course?id=${encodeURIComponent(course.programId)}`, label: course.code ?? courseTitle(course, locale) }] : []),
        ...(exam ? [{ href: `/${locale}/exams/folder?id=${encodeURIComponent(exam.folderId)}`, label: bl.backFolder }] : []),
        { label: exam?.id ? bl.titleEdit : bl.titleNew },
      ]}
    >
      {() => (failed ? <Notice tone="error">{labels.course.notFound}</Notice> : !exam || !course ? <Spinner /> : <Builder initial={exam} course={course} locale={locale} labels={labels} />)}
    </ExamShell>
  );
}

function Builder({ initial, course, locale, labels }: { initial: ExamFull; course: ExamCourse; locale: string; labels: ExamLabels }) {
  const bl = labels.builder;
  const b = labels.bank;
  const ar = locale === "ar";
  const [e, setE] = useState<ExamFull>(initial);
  const [bank, setBank] = useState<BankOverview | null>(null);
  const [scenarios, setScenarios] = useState<ScenarioSummary[]>([]);
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [picker, setPicker] = useState(false);
  const [search, setSearch] = useState({ q: "", type: "", domain: "" });
  const [found, setFound] = useState<QuestionSummary[]>([]);
  const [preview, setPreview] = useState<QuestionFull[] | null>(null);
  const [note, setNote] = useState("");

  const editable = !!e.canEdit && (e.status === "DRAFT" || e.status === "PENDING_APPROVAL" || !e.id);
  const set = (patch: Partial<ExamFull>) => setE((cur) => ({ ...cur, ...patch }));
  const setSec = (patch: Partial<ExamFull["security"]>) => setE((cur) => ({ ...cur, security: { ...cur.security, ...patch } }));
  const setRule = (i: number, patch: Partial<ExamRuleRow>) => setE((cur) => ({ ...cur, rules: cur.rules.map((r, j) => (j === i ? { ...r, ...patch } : r)) }));

  useEffect(() => {
    rpc<BankOverview>("exam_bank_overview", { p_program: course.programId }).then(setBank).catch(() => undefined);
    rpc<ScenarioSummary[]>("exam_bank_scenarios", { p_program: course.programId, p_filter: { status: "ACTIVE" } }).then(setScenarios).catch(() => undefined);
  }, [course.programId]);

  const searchBank = useCallback(async () => {
    try {
      const r = await rpc<{ items: QuestionSummary[] }>("exam_bank_questions", { p_program: course.programId, p_filter: { q: search.q, type: search.type, categoryId: search.domain, status: "ACTIVE", scenarioId: "none", pageSize: 50 } });
      setFound(r.items);
    } catch {
      setFound([]);
    }
  }, [course.programId, search]);
  useEffect(() => {
    if (!picker) return;
    const t = setTimeout(searchBank, 300);
    return () => clearTimeout(t);
  }, [picker, searchBank]);

  const fail = (err: unknown) => setFlash({ tone: "error", text: (bl.errors as Record<string, string>)[examErrorKey(err)] ?? labels.errorGeneric });
  const run = async (fn: () => Promise<ExamFull>, ok: string) => {
    setBusy(true);
    setFlash(null);
    try {
      const r = await fn();
      setE(r);
      setFlash({ tone: "success", text: ok });
      if (!e.id && r.id) window.history.replaceState(null, "", window.location.pathname + `?id=${encodeURIComponent(r.id)}`);
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };
  const save = () => run(() => rpc<ExamFull>("exam_exam_save", { p_e: toSaveExam(e) }), b.saved);
  const publish = async () => {
    setBusy(true);
    setFlash(null);
    try {
      const saved = editable ? await rpc<ExamFull>("exam_exam_save", { p_e: toSaveExam(e) }) : e;
      setE(saved);
      const r = await rpc<ExamFull>("exam_exam_publish", { p_id: saved.id });
      setE(r);
      setFlash({ tone: "success", text: bl.statuses[r.status] });
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };
  const addScenario = async (sid: string) => {
    const s = await rpc<ScenarioFull>("exam_bank_scenario", { p_id: sid });
    const add = (s.questions ?? []).filter((q) => q.status === "ACTIVE" && !e.items.some((i) => i.questionId === q.id));
    set({ items: [...e.items, ...add.map((q) => ({ questionId: q.id, points: null, weight: null, type: q.type, status: q.status, stemAr: q.stemAr, stemEn: q.stemEn, qPoints: q.points, scenarioId: sid }))] });
  };
  const moveItem = (i: number, d: -1 | 1) => {
    const items = [...e.items];
    const j = i + d;
    if (j < 0 || j >= items.length) return;
    [items[i], items[j]] = [items[j], items[i]];
    set({ items });
  };

  const cats = bank?.categories ?? [];
  const check = e.check;
  const ruleAvail = (i: number) => check?.rules?.find((r) => r.position === i + 1)?.available;

  return (
    <div className="space-y-6">
      {/* status + readiness */}
      <div className="flex flex-wrap items-center gap-3">
        <span className={cn("rounded-md px-2.5 py-1 text-sm font-semibold", statusClass(e.status))}>{bl.statuses[e.status]}</span>
        {e.id && <span className="text-sm text-slate">{b.version}{e.version}</span>}
        {e.id && e.status !== "DRAFT" && (
          <Link href={`/${locale}/exams/attempts?id=${encodeURIComponent(e.id)}`} className="btn btn-outline btn-sm">{labels.staffAttempts.open}</Link>
        )}
        <Link href={`/${locale}/exams/folder?id=${encodeURIComponent(e.folderId)}`} className="ms-auto text-sm font-semibold text-brand hover:underline">
          {ar ? "→" : "←"} {bl.backFolder}
        </Link>
      </div>
      {flash && <Notice tone={flash.tone}>{flash.text}</Notice>}
      {e.reviewNote && e.status === "DRAFT" && <Notice tone="error"><span className="font-semibold">{bl.reviewNote}:</span> {e.reviewNote}</Notice>}
      {!editable && e.id && e.status !== "PENDING_APPROVAL" && <Notice>{bl.locked}</Notice>}
      {check && (
        <div className={cn("rounded-2xl border p-4 text-sm", check.ok ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-gold/30 bg-gold/5 text-ink")}>
          <p className="font-bold">{check.ok ? bl.ready : bl.notReady}</p>
          <p className="mt-1">
            {bl.questionCount}: <b>{check.questionCount}</b> · {bl.totalPoints}: <b>{check.variablePoints ? bl.variable : Number(check.fixedPoints)}</b>
          </p>
          {check.issues.length > 0 && (
            <ul className="mt-2 list-inside list-disc">
              {check.issues.map((i, k) => <li key={k}>{issueText(i, bl.issues)}</li>)}
            </ul>
          )}
        </div>
      )}

      <fieldset disabled={!editable || busy} className="space-y-6">
        <Section title={bl.sections.basics}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={bl.titleAr}><input value={e.titleAr} onChange={(x) => set({ titleAr: x.target.value })} className="field" dir="rtl" /></Field>
            <Field label={bl.titleEn}><input value={e.titleEn} onChange={(x) => set({ titleEn: x.target.value })} className="field" dir="ltr" /></Field>
            <Field label={bl.descAr}><textarea value={e.descAr} onChange={(x) => set({ descAr: x.target.value })} rows={3} className="field" dir="rtl" /></Field>
            <Field label={bl.descEn}><textarea value={e.descEn} onChange={(x) => set({ descEn: x.target.value })} rows={3} className="field" dir="ltr" /></Field>
            <Field label={bl.examType}>
              <select value={e.examType} onChange={(x) => set({ examType: x.target.value as ExamFull["examType"] })} className="field">
                {(["PRACTICE", "SIMULATION", "FINAL"] as const).map((t) => <option key={t} value={t}>{bl.types[t]}</option>)}
              </select>
            </Field>
          </div>
        </Section>

        <Section title={bl.sections.questions}>
          {/* hand-picked */}
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-semibold text-navy">{bl.picked} <span className="text-slate">({e.items.length})</span></p>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => setPicker(!picker)} className="btn btn-outline btn-sm" aria-expanded={picker}>+ {bl.addFromBank}</button>
                {scenarios.length > 0 && (
                  <select value="" onChange={(x) => x.target.value && addScenario(x.target.value)} className="field w-auto py-1.5 text-sm">
                    <option value="">+ {bl.addScenario}</option>
                    {scenarios.map((s) => <option key={s.id} value={s.id}>{title(s, locale)} ({s.questions})</option>)}
                  </select>
                )}
              </div>
            </div>
            <p className="text-xs text-slate">{bl.pickedHint}</p>
            {picker && (
              <div className="space-y-2 rounded-xl border border-brand/20 bg-brand/5 p-3">
                <div className="grid gap-2 sm:grid-cols-3">
                  <input type="search" value={search.q} onChange={(x) => setSearch({ ...search, q: x.target.value })} placeholder={bl.searchBank} className="field py-2" />
                  <select value={search.type} onChange={(x) => setSearch({ ...search, type: x.target.value })} className="field py-2">
                    <option value="">{bl.anyType}</option>
                    {QUESTION_TYPES.map((t) => <option key={t} value={t}>{b.types[t]}</option>)}
                  </select>
                  <select value={search.domain} onChange={(x) => setSearch({ ...search, domain: x.target.value })} className="field py-2">
                    <option value="">{bl.anyDomain}</option>
                    {cats.filter((c) => c.kind === "DOMAIN").map((c) => <option key={c.id} value={c.id}>{catName(c, locale)}</option>)}
                  </select>
                </div>
                <ul className="max-h-72 space-y-1 overflow-y-auto">
                  {found.map((q) => {
                    const has = e.items.some((i) => i.questionId === q.id);
                    return (
                      <li key={q.id} className="flex items-center gap-2 rounded-lg bg-white px-3 py-2 text-sm">
                        <span className="shrink-0 rounded bg-mist px-1.5 py-0.5 text-[11px] text-slate">{b.types[q.type]}</span>
                        <span className="min-w-0 flex-1 truncate">{stem(q, locale)}</span>
                        <button type="button" disabled={has} onClick={() => set({ items: [...e.items, { questionId: q.id, points: null, weight: null, type: q.type, status: q.status, stemAr: q.stemAr, stemEn: q.stemEn, qPoints: q.points }] })} className="rounded-lg px-2 py-1 font-semibold text-brand hover:bg-brand/10 disabled:text-slate">
                          {has ? bl.added : bl.add}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
            {e.items.length === 0 ? <p className="text-sm text-slate">{bl.noPicked}</p> : (
              <ol className="space-y-2">
                {e.items.map((it, i) => (
                  <li key={it.questionId} className={cn("flex flex-wrap items-center gap-2 rounded-xl border border-line px-3 py-2", it.status && it.status !== "ACTIVE" && "border-gold/40 bg-gold/5")}>
                    <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-mist text-sm font-bold text-navy">{i + 1}</span>
                    <span className="min-w-0 flex-1 basis-48">
                      <span className="block truncate text-sm text-navy">{stem({ stemAr: it.stemAr ?? "", stemEn: it.stemEn ?? "" }, locale)}</span>
                      <span className="text-xs text-slate">{it.type ? b.types[it.type] : ""}{it.status && it.status !== "ACTIVE" ? ` · ${b.statuses[it.status]}` : ""}</span>
                    </span>
                    <input value={it.points ?? ""} onChange={(x) => set({ items: e.items.map((y, j) => (j === i ? { ...y, points: x.target.value } : y)) })} placeholder={`${bl.pointsOverride} (${it.qPoints != null ? Number(it.qPoints) : bl.own})`} className="field w-28 py-1.5 text-sm" dir="ltr" inputMode="decimal" />
                    <input value={it.weight ?? ""} onChange={(x) => set({ items: e.items.map((y, j) => (j === i ? { ...y, weight: x.target.value } : y)) })} placeholder={bl.weightOverride} className="field w-20 py-1.5 text-sm" dir="ltr" inputMode="decimal" />
                    <button type="button" onClick={() => moveItem(i, -1)} disabled={i === 0} className="rounded-lg px-2 py-1 text-slate hover:bg-mist disabled:opacity-30" aria-label={b.editor.up}>↑</button>
                    <button type="button" onClick={() => moveItem(i, 1)} disabled={i === e.items.length - 1} className="rounded-lg px-2 py-1 text-slate hover:bg-mist disabled:opacity-30" aria-label={b.editor.down}>↓</button>
                    <button type="button" onClick={() => set({ items: e.items.filter((_, j) => j !== i) })} className="rounded-lg px-2 py-1 text-sm text-gold-600 hover:bg-gold/10">{bl.remove}</button>
                  </li>
                ))}
              </ol>
            )}
          </div>

          {/* random rules */}
          <div className="space-y-3 border-t border-line pt-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-semibold text-navy">{bl.rules} <span className="text-slate">({e.rules.length})</span></p>
              <button type="button" onClick={() => set({ rules: [...e.rules, blankRule()] })} className="btn btn-outline btn-sm">+ {bl.addRule}</button>
            </div>
            <p className="text-xs text-slate">{bl.rulesHint}</p>
            {e.rules.map((r, i) => (
              <div key={i} className="space-y-2 rounded-xl border border-line p-3">
                <div className="flex flex-wrap items-end gap-2">
                  <Field label={bl.count} className="w-24"><input type="number" min={1} max={500} value={r.count} onChange={(x) => setRule(i, { count: x.target.value })} className="field py-2" dir="ltr" /></Field>
                  {!r.scenarios && (
                    <>
                      <select value={r.domainId ?? ""} onChange={(x) => setRule(i, { domainId: x.target.value || null, topicId: null, subtopicId: null })} className="field w-auto py-2 text-sm">
                        <option value="">{bl.anyDomain}</option>
                        {cats.filter((c) => c.kind === "DOMAIN").map((c) => <option key={c.id} value={c.id}>{catName(c, locale)}</option>)}
                      </select>
                      <select value={r.topicId ?? ""} onChange={(x) => setRule(i, { topicId: x.target.value || null, subtopicId: null })} className="field w-auto py-2 text-sm">
                        <option value="">{bl.anyTopic}</option>
                        {cats.filter((c) => c.kind === "TOPIC" && (!r.domainId || c.parentId === r.domainId)).map((c) => <option key={c.id} value={c.id}>{catName(c, locale)}</option>)}
                      </select>
                      <select value={r.subtopicId ?? ""} onChange={(x) => setRule(i, { subtopicId: x.target.value || null })} className="field w-auto py-2 text-sm">
                        <option value="">{bl.anySubtopic}</option>
                        {cats.filter((c) => c.kind === "SUBTOPIC" && (!r.topicId || c.parentId === r.topicId)).map((c) => <option key={c.id} value={c.id}>{catName(c, locale)}</option>)}
                      </select>
                      <select value={r.qtype ?? ""} onChange={(x) => setRule(i, { qtype: (x.target.value || null) as ExamRuleRow["qtype"] })} className="field w-auto py-2 text-sm">
                        <option value="">{bl.anyType}</option>
                        {QUESTION_TYPES.map((t) => <option key={t} value={t}>{b.types[t]}</option>)}
                      </select>
                    </>
                  )}
                  <select value={r.difficulty ?? ""} onChange={(x) => setRule(i, { difficulty: (x.target.value || null) as ExamRuleRow["difficulty"] })} className="field w-auto py-2 text-sm">
                    <option value="">{bl.anyDifficulty}</option>
                    {(["EASY", "MEDIUM", "HARD"] as const).map((d) => <option key={d} value={d}>{b.difficulties[d]}</option>)}
                  </select>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <Toggle label={bl.wholeScenarios} checked={r.scenarios} onChange={(v) => setRule(i, { scenarios: v })} />
                  {!r.scenarios && (
                    <>
                      <input value={r.points ?? ""} onChange={(x) => setRule(i, { points: x.target.value })} placeholder={`${bl.pointsOverride} (${bl.own})`} className="field w-32 py-1.5 text-sm" dir="ltr" inputMode="decimal" />
                      <input value={r.weight ?? ""} onChange={(x) => setRule(i, { weight: x.target.value })} placeholder={bl.weightOverride} className="field w-24 py-1.5 text-sm" dir="ltr" inputMode="decimal" />
                    </>
                  )}
                  {ruleAvail(i) !== undefined && (
                    <span className={cn("rounded-md px-2 py-0.5 text-xs font-semibold", (ruleAvail(i) ?? 0) >= Number(r.count) ? "bg-emerald-50 text-emerald-700" : "bg-gold/10 text-gold-600")}>
                      {ruleAvail(i)} {bl.available}
                    </span>
                  )}
                  <button type="button" onClick={() => set({ rules: e.rules.filter((_, j) => j !== i) })} className="ms-auto rounded-lg px-2 py-1 text-sm text-gold-600 hover:bg-gold/10">{bl.remove}</button>
                </div>
              </div>
            ))}
          </div>
        </Section>

        <div className="grid gap-6 lg:grid-cols-2">
          <Section title={bl.sections.scoring}>
            <Field label={bl.passPercent} className="max-w-[10rem]"><input type="number" min={0} max={100} step={0.5} value={e.passPercent} onChange={(x) => set({ passPercent: x.target.value })} className="field" dir="ltr" /></Field>
          </Section>
          <Section title={bl.sections.order}>
            <Toggle label={bl.shuffleQuestions} checked={e.shuffleQuestions} onChange={(v) => set({ shuffleQuestions: v })} />
            <Toggle label={bl.shuffleOptions} checked={e.shuffleOptions} onChange={(v) => set({ shuffleOptions: v })} />
          </Section>
        </div>

        <Section title={bl.sections.timing}>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field label={bl.duration}><input type="number" min={1} max={600} value={e.durationMinutes ?? ""} onChange={(x) => set({ durationMinutes: x.target.value === "" ? null : Number(x.target.value) })} className="field" dir="ltr" /></Field>
            <Field label={bl.grace}><input type="number" min={0} max={600} value={e.graceSeconds} onChange={(x) => set({ graceSeconds: Number(x.target.value || 0) })} className="field" dir="ltr" /></Field>
            <Field label={bl.maxAttempts}><input type="number" min={1} max={100} value={e.maxAttempts ?? ""} onChange={(x) => set({ maxAttempts: x.target.value === "" ? null : Number(x.target.value) })} className="field" dir="ltr" /></Field>
            <Field label={bl.startsAt}><input type="datetime-local" value={toLocalInput(e.startsAt)} onChange={(x) => set({ startsAt: fromLocalInput(x.target.value) })} className="field" dir="ltr" /></Field>
            <Field label={bl.endsAt}><input type="datetime-local" value={toLocalInput(e.endsAt)} onChange={(x) => set({ endsAt: fromLocalInput(x.target.value) })} className="field" dir="ltr" /></Field>
            <Field label={bl.resume}>
              <select value={e.resumePolicy} onChange={(x) => set({ resumePolicy: x.target.value as ExamFull["resumePolicy"] })} className="field">
                {(["RESUME", "NO_RESUME"] as const).map((m) => <option key={m} value={m}>{bl.resumeModes[m]}</option>)}
              </select>
            </Field>
          </div>
        </Section>

        <div className="grid gap-6 lg:grid-cols-2">
          <Section title={bl.sections.review}>
            <Field label={bl.reviewPolicy}>
              <select value={e.reviewPolicy} onChange={(x) => set({ reviewPolicy: x.target.value as ExamFull["reviewPolicy"] })} className="field">
                {(["NEVER", "AFTER_SUBMIT", "AFTER_CLOSE"] as const).map((m) => <option key={m} value={m}>{bl.reviewModes[m]}</option>)}
              </select>
            </Field>
            <Field label={bl.resultsPolicy}>
              <select value={e.resultsPolicy} onChange={(x) => set({ resultsPolicy: x.target.value as ExamFull["resultsPolicy"] })} className="field">
                {(["IMMEDIATE", "AFTER_CLOSE", "MANUAL"] as const).map((m) => <option key={m} value={m}>{bl.resultsModes[m]}</option>)}
              </select>
            </Field>
            <Toggle label={bl.showCorrect} checked={e.showCorrect} onChange={(v) => set({ showCorrect: v })} />
            <Toggle label={bl.showFeedback} checked={e.showFeedback} onChange={(v) => set({ showFeedback: v })} />
            <Toggle label={bl.showExplanation} checked={e.showExplanation} onChange={(v) => set({ showExplanation: v })} />
          </Section>
          <Section title={bl.sections.tools}>
            <Toggle label={bl.calculator} checked={e.allowCalculator} onChange={(v) => set({ allowCalculator: v })} />
            <Toggle label={bl.whiteboard} checked={e.allowWhiteboard} onChange={(v) => set({ allowWhiteboard: v })} />
            <Toggle label={bl.translation} checked={e.allowTranslation} onChange={(v) => set({ allowTranslation: v })} />
          </Section>
        </div>

        <Section title={bl.sections.security}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Toggle label={bl.fullscreen} checked={e.security.fullscreen} onChange={(v) => setSec({ fullscreen: v })} />
            <Toggle label={bl.detectBlur} checked={e.security.detectBlur} onChange={(v) => setSec({ detectBlur: v })} />
            <Toggle label={bl.watermark} checked={e.security.watermark} onChange={(v) => setSec({ watermark: v })} />
            <Toggle label={bl.blockCopy} checked={e.security.blockCopy} onChange={(v) => setSec({ blockCopy: v })} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={bl.maxWarnings}><input type="number" min={0} max={50} value={e.security.maxWarnings} onChange={(x) => setSec({ maxWarnings: Number(x.target.value || 0) })} className="field" dir="ltr" /></Field>
            <Field label={bl.onExceed}>
              <select value={e.security.onExceed} onChange={(x) => setSec({ onExceed: x.target.value as ExamFull["security"]["onExceed"] })} className="field">
                {(["WARN", "SUBMIT", "REVIEW"] as const).map((m) => <option key={m} value={m}>{bl.exceedModes[m]}</option>)}
              </select>
            </Field>
          </div>
        </Section>
      </fieldset>

      {/* actions */}
      <div className="card flex flex-wrap items-center gap-3 p-5">
        {editable && (
          <>
            <button type="button" onClick={save} disabled={busy} className="btn btn-outline">{e.id ? bl.saveCheck : bl.saveDraft}</button>
            <button type="button" onClick={publish} disabled={busy} className="btn btn-primary">{e.canPublish ? bl.publish : bl.sendApproval}</button>
          </>
        )}
        {e.id && e.status === "PENDING_APPROVAL" && e.canApprove && (
          <>
            <button type="button" onClick={() => run(() => rpc<ExamFull>("exam_exam_review", { p_id: e.id, p_approve: true, p_note: "" }), bl.statuses.PUBLISHED)} disabled={busy} className="btn btn-primary">{bl.approve}</button>
            <input value={note} onChange={(x) => setNote(x.target.value)} placeholder={bl.returnNote} className="field w-64 py-2" />
            <button type="button" onClick={() => run(() => rpc<ExamFull>("exam_exam_review", { p_id: e.id, p_approve: false, p_note: note }), bl.statuses.DRAFT)} disabled={busy} className="btn btn-outline">{bl.returnDraft}</button>
          </>
        )}
        {e.id && e.canEdit && e.status === "PUBLISHED" && <button type="button" onClick={() => run(() => rpc<ExamFull>("exam_exam_set_status", { p_id: e.id, p_status: "STOPPED" }), bl.statuses.STOPPED)} disabled={busy} className="btn btn-outline">{bl.stop}</button>}
        {e.id && e.canEdit && e.status === "STOPPED" && (
          <>
            <button type="button" onClick={publish} disabled={busy} className="btn btn-primary">{e.canPublish ? bl.publish : bl.sendApproval}</button>
            <button type="button" onClick={() => run(() => rpc<ExamFull>("exam_exam_set_status", { p_id: e.id, p_status: "DRAFT" }), bl.statuses.DRAFT)} disabled={busy} className="btn btn-outline">{bl.toDraft}</button>
          </>
        )}
        {e.id && e.canEdit && (e.status === "DRAFT" || e.status === "STOPPED") && <button type="button" onClick={() => run(() => rpc<ExamFull>("exam_exam_set_status", { p_id: e.id, p_status: "ARCHIVED" }), bl.statuses.ARCHIVED)} disabled={busy} className="btn btn-outline">{bl.archive}</button>}
        {e.id && e.canEdit && e.status === "ARCHIVED" && <button type="button" onClick={() => run(() => rpc<ExamFull>("exam_exam_set_status", { p_id: e.id, p_status: "DRAFT" }), bl.statuses.DRAFT)} disabled={busy} className="btn btn-outline">{bl.toDraft}</button>}
        {e.id && e.canEdit && (e.status === "DRAFT" || e.status === "ARCHIVED") && (
          <button
            type="button"
            onClick={async () => {
              if (!window.confirm(bl.confirmDelete)) return;
              try {
                await rpc("exam_exam_delete", { p_id: e.id });
                window.location.assign(window.location.pathname.replace(/exam\/?$/, "folder/") + `?id=${encodeURIComponent(e.folderId)}`);
              } catch (err) {
                fail(err);
              }
            }}
            className="rounded-lg px-3 py-2 text-sm text-gold-600 hover:bg-gold/10"
          >
            {bl.delete}
          </button>
        )}
        {e.id && (
          <button
            type="button"
            onClick={async () => {
              try {
                const r = await rpc<{ questions: QuestionFull[] }>("exam_exam_preview", { p_id: e.id });
                setPreview(r.questions);
              } catch (err) {
                fail(err);
              }
            }}
            className="btn btn-outline ms-auto"
          >
            {bl.preview}
          </button>
        )}
      </div>

      {preview && (
        <section className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-xl font-bold">{bl.preview} ({preview.length})</h2>
            <button type="button" onClick={() => setPreview(null)} className="btn btn-outline btn-sm">{b.editor.cancel}</button>
          </div>
          <p className="text-sm text-slate">{bl.previewHint}</p>
          <ol className="space-y-6">
            {preview.map((q, i) => (
              <li key={q.id + i}>
                <p className="mb-2 text-sm font-semibold text-slate">{i + 1} / {preview.length}</p>
                <QuestionPreview q={q} locale={locale} labels={labels} />
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}
