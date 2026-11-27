"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { can, courseTitle, rpc, type ExamMe } from "@/lib/exams/client";
import { accounts, ENROLL_STATUSES, type EnrollStatus, type PeopleData, type Person, type PersonKind } from "@/lib/exams/people";
import { untilDay } from "@/lib/exams/days";
import type { AdminCourse } from "@/lib/exams/manage";
import { toCsv, toXlsx } from "@/lib/exams/io/sheets";
import { cn } from "@/lib/utils";
import { Notice, Spinner, type ExamLabels } from "@/components/exams/ExamShell";
import { ManageShell, SectionTitle } from "./ManageShell";
import { PeopleImport } from "./PeopleImport";
import { CSV_MIME, day, download, LinkBox, peopleError, stamp, SubBadge, subLabel, subState, XLSX_MIME, type Flash } from "./peopleShared";

/** /[locale]/manage/trainees and /[locale]/manage/trainers */
export function ManagePeople({ locale, labels, kind }: { locale: string; labels: ExamLabels; kind: PersonKind }) {
  return (
    <ManageShell locale={locale} labels={labels} section={kind === "trainer" ? "trainers" : "trainees"}>
      {(me) => <People me={me} kind={kind} locale={locale} labels={labels} />}
    </ManageShell>
  );
}

type Filter = { q: string; programId: string; status: string; enrollment: string; from: string; to: string };
const NONE: Filter = { q: "", programId: "", status: "", enrollment: "", from: "", to: "" };

function People({ me, kind, locale, labels }: { me: ExamMe; kind: PersonKind; locale: string; labels: ExamLabels }) {
  const t = labels.manage.people;
  const section = kind === "trainer" ? t.trainers : t.trainees;
  const trainee = kind === "trainee";
  const mayCreate = can(me, "users", "create") && (trainee || can(me, "trainers", "update"));
  const mayEnroll = trainee && can(me, "trainees", "update");
  const mayExport = can(me, "users", "export");
  // a course page links here with its trainees already filtered (this part only renders in the browser)
  const [filter, setFilter] = useState<Filter>(() => ({ ...NONE, programId: new URLSearchParams(window.location.search).get("course") ?? "" }));
  const [page, setPage] = useState(1);
  const [data, setData] = useState<PeopleData | null>(null);
  const [courses, setCourses] = useState<AdminCourse[]>([]);
  const [loading, setLoading] = useState(true);
  const [flash, setFlash] = useState<Flash>(null);
  const [panel, setPanel] = useState<"add" | "import" | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [version, setVersion] = useState(0);

  const clean = useCallback((f: Filter) => ({ kind, ...Object.fromEntries(Object.entries(f).filter(([, v]) => v !== "")) }), [kind]);

  useEffect(() => {
    rpc<AdminCourse[]>("exam_admin_courses").then(setCourses).catch((e) => setFlash({ tone: "error", text: peopleError(e, labels) }));
  }, [labels]);

  useEffect(() => {
    let live = true;
    setLoading(true);
    const timer = setTimeout(
      () =>
        rpc<PeopleData>("exam_people", { p_filter: { ...clean(filter), page } })
          .then((d) => live && setData(d))
          .catch((e) => live && setFlash({ tone: "error", text: peopleError(e, labels) }))
          .finally(() => live && setLoading(false)),
      filter.q ? 400 : 0,
    );
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [filter, page, version, clean, labels]);

  // a changed filter drops the selection, so an action never touches people that are no longer listed
  const set = (patch: Partial<Filter>) => {
    setPicked([]);
    setPage(1);
    setFilter((f) => ({ ...f, ...patch }));
  };
  const reload = () => setVersion((v) => v + 1);

  const exportList = async (type: "xlsx" | "csv") => {
    setFlash(null);
    try {
      const all = await rpc<PeopleData>("exam_people", { p_filter: { ...clean(filter), export: true } });
      const c = t.cols;
      const subs = (p: Person) => p.enrollments.map((e) => `${e.code}: ${subLabel(subState(e), labels)}${e.expiresAt ? ` (${untilDay(e.expiresAt)})` : ""}`).join(" | ");
      const rows = [
        [c.name, c.email, c.phone, c.organization, c.jobTitle, c.city, c.registered, c.status, ...(trainee ? [c.subscriptions, c.attempts, c.lastAttempt] : [c.courses, c.specialties, c.experience])],
        ...all.items.map((p) => [
          p.name, p.email, p.phone, p.organization, p.jobTitle, p.city, p.createdAt.slice(0, 10), p.active ? labels.admin.active : labels.admin.disabled,
          ...(trainee ? [subs(p), p.attempts, p.lastAttemptAt?.slice(0, 10) ?? ""] : [p.courses.join(", "), p.specialties.replace(/\n/g, " | "), p.experienceYears]),
        ]),
      ];
      const name = `${trainee ? "trainees" : "trainers"}-${stamp()}`;
      if (type === "csv") download(`${name}.csv`, toCsv(rows), CSV_MIME);
      else download(`${name}.xlsx`, toXlsx([{ name: section.title, rows }], locale === "ar") as BlobPart, XLSX_MIME);
    } catch (e) {
      setFlash({ tone: "error", text: peopleError(e, labels) });
    }
  };

  const pages = Math.max(1, Math.ceil((data?.total ?? 0) / (data?.pageSize ?? 25)));
  const pageIds = data?.items.map((p) => p.id) ?? [];
  const pageAll = pageIds.length > 0 && pageIds.every((id) => picked.includes(id));
  const filtered = JSON.stringify(filter) !== JSON.stringify(NONE);
  const courseOptions = courses.map((c) => <option key={c.programId} value={c.programId}>{c.code ? `${c.code} — ` : ""}{courseTitle(c, locale)}</option>);

  return (
    <div className="space-y-5">
      <SectionTitle title={section.title} text={section.intro}>
        <div className="flex flex-wrap gap-2">
          {mayCreate && <button type="button" onClick={() => { setFlash(null); setPanel("add"); }} className="btn btn-primary btn-sm">+ {section.add}</button>}
          {trainee && can(me, "users", "create") && <button type="button" onClick={() => { setFlash(null); setPanel("import"); }} className="btn btn-outline btn-sm">{t.import.button}</button>}
        </div>
      </SectionTitle>

      {flash && <Notice tone={flash.tone}>{flash.text}</Notice>}
      {panel === "add" && <AddPerson me={me} kind={kind} courses={courses} locale={locale} labels={labels} onCreated={reload} onClose={() => setPanel(null)} />}
      {panel === "import" && <PeopleImport me={me} course={courses[0]?.code ?? "PMP"} locale={locale} labels={labels} onDone={reload} onClose={() => setPanel(null)} />}

      <div className="card grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3">
        <label className="text-sm font-semibold text-navy">
          {labels.admin.search}
          <input type="search" className="field mt-1 w-full" value={filter.q} onChange={(e) => set({ q: e.target.value })} placeholder={t.search} />
        </label>
        <label className="text-sm font-semibold text-navy">
          {labels.admin.course}
          <select className="field mt-1 w-full" value={filter.programId} onChange={(e) => set({ programId: e.target.value })}>
            <option value="">{t.all}</option>
            {courseOptions}
          </select>
        </label>
        <label className="text-sm font-semibold text-navy">
          {t.filters.account}
          <select className="field mt-1 w-full" value={filter.status} onChange={(e) => set({ status: e.target.value })}>
            <option value="">{t.all}</option>
            <option value="active">{labels.admin.active}</option>
            <option value="disabled">{labels.admin.disabled}</option>
          </select>
        </label>
        {trainee && (
          <label className="text-sm font-semibold text-navy">
            {t.filters.subscription}
            <select className="field mt-1 w-full" value={filter.enrollment} onChange={(e) => set({ enrollment: e.target.value })}>
              <option value="">{t.all}</option>
              <option value="ACTIVE">{labels.manage.member.subscriptions.open}</option>
              <option value="EXPIRED">{labels.manage.member.subscriptions.expired}</option>
              {(["SUSPENDED", "COMPLETED", "CANCELLED"] as const).map((s) => <option key={s} value={s}>{labels.admin.enrollmentStatus[s]}</option>)}
              <option value="NONE">{t.filters.none}</option>
            </select>
          </label>
        )}
        <label className="text-sm font-semibold text-navy">
          {t.filters.from}
          <input type="date" className="field mt-1 w-full" value={filter.from} onChange={(e) => set({ from: e.target.value })} />
        </label>
        <label className="text-sm font-semibold text-navy">
          {t.filters.to}
          <input type="date" className="field mt-1 w-full" value={filter.to} onChange={(e) => set({ to: e.target.value })} />
        </label>
        <div className="flex flex-wrap items-center gap-2 sm:col-span-2 xl:col-span-3">
          {data && <span className="text-sm text-slate" role="status">{t.total.replace("{n}", String(data.total))}</span>}
          {filtered && <button type="button" className="btn btn-outline btn-sm" onClick={() => set(NONE)}>{t.reset}</button>}
          <span className="flex-1" />
          {mayExport && (
            <>
              <button type="button" disabled={!data?.total} className="btn btn-primary btn-sm" onClick={() => exportList("xlsx")}>{t.export}</button>
              <button type="button" disabled={!data?.total} className="btn btn-outline btn-sm" onClick={() => exportList("csv")}>{t.exportCsv}</button>
            </>
          )}
        </div>
      </div>

      {mayEnroll && !!data?.items.length && (
        <BulkSubscribe
          picked={picked}
          pageAll={pageAll}
          onPage={(on) => setPicked(on ? [...new Set([...picked, ...pageIds])] : picked.filter((id) => !pageIds.includes(id)))}
          onClear={() => setPicked([])}
          courseOptions={courseOptions}
          labels={labels}
          onDone={(text, tone) => { setFlash({ tone, text }); if (tone === "success") setPicked([]); reload(); }}
        />
      )}

      {loading && <Spinner />}
      {!loading && data && data.items.length === 0 && <p className="text-slate">{filtered ? labels.admin.noMembers : section.empty}</p>}
      {!loading && data && data.items.length > 0 && (
        <ul className="space-y-3">
          {data.items.map((p) => (
            <li key={p.id} className={cn("card flex flex-wrap items-center gap-x-5 gap-y-3 p-4", !p.active && "opacity-70")}>
              {mayEnroll && (
                <input type="checkbox" className="h-4 w-4 accent-[var(--color-brand)]" checked={picked.includes(p.id)} onChange={(e) => setPicked(e.target.checked ? [...picked, p.id] : picked.filter((x) => x !== p.id))} aria-label={t.select.replace("{name}", p.name)} />
              )}
              <div className="min-w-0 flex-1 basis-52">
                <p className="truncate font-bold text-navy">{p.name}</p>
                <p className="truncate text-sm text-slate" dir="ltr">{p.email}</p>
                {(p.phone || p.organization) && <p className="truncate text-xs text-slate"><bdi dir="ltr">{p.phone}</bdi>{p.phone && p.organization ? " · " : ""}{p.organization}</p>}
              </div>
              <div className="flex max-w-md flex-wrap gap-1.5">
                {trainee
                  ? p.enrollments.map((e) => <SubBadge key={e.programId} s={e} labels={labels} locale={locale} />)
                  : p.courses.map((c) => <span key={c} className="rounded-md bg-mist px-2 py-0.5 text-xs font-semibold text-navy" dir="ltr">{c}</span>)}
                {(trainee ? p.enrollments.length : p.courses.length) === 0 && <span className="text-xs text-slate">{t.filters.none}</span>}
              </div>
              <div className="text-xs text-slate">
                <span className="block">{t.cols.registered}: {day(p.createdAt, locale)}</span>
                {trainee && <span className="block">{t.cols.attempts}: {p.attempts}</span>}
              </div>
              <span className={cn("rounded-full px-2.5 py-1 text-xs font-semibold", p.active ? "bg-emerald-50 text-emerald-700" : "bg-gold/10 text-gold-600")}>{p.active ? labels.admin.active : labels.admin.disabled}</span>
              <Link href={`/${locale}/manage/member?id=${encodeURIComponent(p.id)}`} className="btn btn-outline btn-sm">{t.open}</Link>
            </li>
          ))}
        </ul>
      )}
      {pages > 1 && (
        <div className="flex items-center justify-center gap-3 text-sm">
          <button type="button" disabled={page <= 1 || loading} onClick={() => setPage(page - 1)} className="btn btn-outline btn-sm">{labels.manage.audit.prev}</button>
          <span className="text-slate">{labels.manage.audit.page.replace("{p}", String(page)).replace("{n}", String(pages))}</span>
          <button type="button" disabled={page >= pages || loading} onClick={() => setPage(page + 1)} className="btn btn-outline btn-sm">{labels.manage.audit.next}</button>
        </div>
      )}
    </div>
  );
}

function BulkSubscribe({
  picked,
  pageAll,
  onPage,
  onClear,
  courseOptions,
  labels,
  onDone,
}: {
  picked: string[];
  pageAll: boolean;
  onPage: (on: boolean) => void;
  onClear: () => void;
  courseOptions: React.ReactNode;
  labels: ExamLabels;
  onDone: (text: string, tone: "success" | "error") => void;
}) {
  const t = labels.manage.people;
  const [course, setCourse] = useState("");
  const [status, setStatus] = useState<EnrollStatus>("ACTIVE");
  const [until, setUntil] = useState("");
  const [busy, setBusy] = useState(false);

  const apply = async () => {
    if (!window.confirm(t.bulk.confirm.replace("{n}", String(picked.length)))) return;
    setBusy(true);
    try {
      let done = 0;
      for (let i = 0; i < picked.length; i += 200) {
        const r = await rpc<{ done: number }>("exam_enrollment_set", { p_members: picked.slice(i, i + 200), p_program: course, p_data: { status, ...(until ? { expiresAt: until } : {}) } });
        done += r.done;
      }
      onDone(t.bulk.done.replace("{n}", String(done)), "success");
    } catch (e) {
      onDone(peopleError(e, labels), "error");
    }
    setBusy(false);
  };

  return (
    <div className="rounded-xl border border-line bg-mist/60 px-4 py-3 text-sm">
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 font-semibold text-navy">
          <input type="checkbox" className="h-4 w-4 accent-[var(--color-brand)]" checked={pageAll} onChange={(e) => onPage(e.target.checked)} />
          {t.selectPage}
        </label>
        {picked.length > 0 && (
          <>
            <span className="font-bold text-navy">{t.selected.replace("{n}", String(picked.length))}</span>
            <button type="button" onClick={onClear} className="text-gold-600 hover:underline">{labels.bank.bulk.clear}</button>
          </>
        )}
      </div>
      {picked.length > 0 && (
        <div className="mt-3 flex flex-wrap items-end gap-3 border-t border-line pt-3">
          <label className="text-sm">
            <span className="mb-1 block font-semibold text-navy">{labels.admin.course}</span>
            <select value={course} onChange={(e) => setCourse(e.target.value)} className="field w-auto max-w-full">
              <option value="">{labels.admin.chooseCourse}</option>
              {courseOptions}
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-semibold text-navy">{t.cols.status}</span>
            <select value={status} onChange={(e) => setStatus(e.target.value as EnrollStatus)} className="field w-auto">
              {ENROLL_STATUSES.map((s) => <option key={s} value={s}>{labels.admin.enrollmentStatus[s]}</option>)}
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-semibold text-navy">{t.cols.validUntil}</span>
            <input type="date" value={until} onChange={(e) => setUntil(e.target.value)} className="field w-auto" />
          </label>
          <button type="button" disabled={busy || !course} onClick={apply} className="btn btn-primary btn-sm">{t.bulk.apply}</button>
          <span className="basis-full text-xs text-slate">{t.bulk.hint}</span>
        </div>
      )}
    </div>
  );
}

const EMPTY = { name: "", email: "", phone: "", organization: "", jobTitle: "", city: "" };

function AddPerson({ me, kind, courses, locale, labels, onCreated, onClose }: { me: ExamMe; kind: PersonKind; courses: AdminCourse[]; locale: string; labels: ExamLabels; onCreated: () => void; onClose: () => void }) {
  const t = labels.manage.people;
  const f = t.form;
  const mayEnroll = kind === "trainee" && can(me, "trainees", "update");
  const [v, setV] = useState(EMPTY);
  const [course, setCourse] = useState("");
  const [until, setUntil] = useState("");
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<Flash>(null);
  const [made, setMade] = useState<{ memberId: string; email: string; link: string | null } | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setFlash(null);
    setMade(null);
    try {
      const r = await accounts<{ memberId: string; email: string; link: string | null; replaced: boolean }>(
        { action: "create", account: { ...v, role: kind === "trainer" ? "INSTRUCTOR" : "LEARNER" } },
        locale,
      );
      let note = r.replaced ? f.replaced : "";
      if (mayEnroll && course) {
        try {
          await rpc("exam_enrollment_set", { p_members: [r.memberId], p_program: course, p_data: { status: "ACTIVE", ...(until ? { expiresAt: until } : {}) } });
        } catch (err) {
          note = `${f.notSubscribed} ${peopleError(err, labels)}`;
        }
      }
      setMade(r);
      setFlash({ tone: "success", text: [f.created, note].filter(Boolean).join(" ") });
      setV(EMPTY);
      setCourse("");
      setUntil("");
      onCreated();
    } catch (err) {
      setFlash({ tone: "error", text: peopleError(err, labels) });
    }
    setBusy(false);
  };

  return (
    <section className="card space-y-4 p-5" aria-label={kind === "trainer" ? t.trainers.add : t.trainees.add}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-bold text-navy">{kind === "trainer" ? t.trainers.add : t.trainees.add}</h3>
          <p className="text-sm text-slate">{f.hint}</p>
        </div>
        <button type="button" onClick={onClose} className="btn btn-outline btn-sm">{f.close}</button>
      </div>
      {flash && <Notice tone={flash.tone}>{flash.text}</Notice>}
      {made?.link && <LinkBox link={made.link} email={made.email} labels={labels} onClose={() => setMade({ ...made, link: null })} />}
      {made && <Link href={`/${locale}/manage/member?id=${encodeURIComponent(made.memberId)}`} className="inline-block text-sm font-semibold text-brand hover:underline">{t.open}</Link>}
      <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
        {(["name", "email", "phone", "organization", "jobTitle", "city"] as const).map((k) => (
          <label key={k} className="text-sm">
            <span className="mb-1 block font-semibold text-navy">{t.cols[k]}{k === "name" || k === "email" ? " *" : ""}</span>
            <input
              className="field w-full"
              type={k === "email" ? "email" : k === "phone" ? "tel" : "text"}
              dir={k === "email" || k === "phone" ? "ltr" : undefined}
              required={k === "name" || k === "email"}
              maxLength={k === "email" ? 200 : k === "phone" ? 30 : 120}
              value={v[k]}
              onChange={(e) => setV({ ...v, [k]: e.target.value })}
              autoComplete="off"
            />
          </label>
        ))}
        {mayEnroll && (
          <>
            <label className="text-sm">
              <span className="mb-1 block font-semibold text-navy">{f.course}</span>
              <select value={course} onChange={(e) => setCourse(e.target.value)} className="field w-full">
                <option value="">—</option>
                {courses.map((c) => <option key={c.programId} value={c.programId}>{c.code ? `${c.code} — ` : ""}{courseTitle(c, locale)}</option>)}
              </select>
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-semibold text-navy">{t.cols.validUntil}</span>
              <input type="date" value={until} onChange={(e) => setUntil(e.target.value)} disabled={!course} className="field w-full" />
              <span className="text-xs text-slate">{t.untilHint}</span>
            </label>
          </>
        )}
        <div className="sm:col-span-2">
          <button type="submit" disabled={busy} className="btn btn-primary btn-sm">{busy ? f.creating : f.create}</button>
        </div>
      </form>
    </section>
  );
}
