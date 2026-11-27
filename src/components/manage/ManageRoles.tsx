"use client";

import { useCallback, useEffect, useState } from "react";
import { ExamError, rpc, type ExamMe, type Role } from "@/lib/exams/client";
import { orderedSections, roleName, type AdminRole, type Catalogue, type RolesData } from "@/lib/exams/manage";
import { cn } from "@/lib/utils";
import { Notice, Spinner, type ExamLabels } from "@/components/exams/ExamShell";
import { ManageShell, SectionTitle } from "./ManageShell";

/** /[locale]/manage/roles — basic roles and the super admin's custom admin roles */
export function ManageRoles({ locale, labels }: { locale: string; labels: ExamLabels }) {
  return (
    <ManageShell locale={locale} labels={labels} section="roles">
      {(me, reload) => <Roles me={me} reloadMe={reload} locale={locale} labels={labels} />}
    </ManageShell>
  );
}

type Draft = Pick<AdminRole, "nameAr" | "nameEn" | "descAr" | "descEn" | "active" | "permissions"> & { id?: string; system?: boolean; members?: number; wasActive?: boolean };
const BLANK: Draft = { nameAr: "", nameEn: "", descAr: "", descEn: "", active: true, permissions: {} };

type SectionLabels = Record<string, Record<string, string>>;

function errorText(e: unknown, labels: ExamLabels) {
  const msg = e instanceof ExamError ? e.message : "";
  const key = Object.keys(labels.manage.roles.errors).find((k) => msg.includes(k));
  if (key) return (labels.manage.roles.errors as Record<string, string>)[key];
  return (labels.admin.errors as Record<string, string>)[e instanceof ExamError ? e.code : ""] ?? labels.errorGeneric;
}

function Roles({ me, reloadMe, locale, labels }: { me: ExamMe; reloadMe: () => void; locale: string; labels: ExamLabels }) {
  const t = labels.manage.roles;
  const isSuper = me.role === "ADMIN";
  const [data, setData] = useState<RolesData | null>(null);
  const [failed, setFailed] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [flash, setFlash] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => rpc<RolesData>("exam_roles").then(setData).catch(() => setFailed(true)), []);
  useEffect(() => {
    load();
  }, [load]);

  const run = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true);
    setFlash(null);
    try {
      await fn();
      setFlash({ tone: "success", text: done });
      setDraft(null);
      await load();
      reloadMe();
    } catch (e) {
      setFlash({ tone: "error", text: errorText(e, labels) });
    }
    setBusy(false);
  };

  const save = () => {
    if (!draft) return;
    if (draft.wasActive && !draft.active && (draft.members ?? 0) > 0 && !window.confirm(t.confirmOff.replace("{n}", String(draft.members)))) return;
    const { id, nameAr, nameEn, descAr, descEn, active, permissions } = draft;
    run(() => rpc("exam_role_save", { p_role: { id, nameAr, nameEn, descAr, descEn, active, permissions } }), t.saved);
  };
  const open = (r: AdminRole) => {
    setFlash(null);
    setDraft({ ...r, wasActive: r.active });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  if (failed) return <Notice tone="error">{labels.errorGeneric}</Notice>;
  if (!data) return <Spinner />;
  const actionLabels = t.actions as SectionLabels;
  const sectionName = (s: string) => (t.sections as Record<string, string>)[s] ?? s;
  const summary = (p: Catalogue) => orderedSections(data.catalogue).filter((s) => p[s]?.length).map(sectionName).join(locale === "ar" ? "، " : ", ");

  return (
    <div className="space-y-6">
      <SectionTitle title={t.title} text={t.intro}>
        {isSuper && !draft && (
          <button type="button" onClick={() => { setFlash(null); setDraft({ ...BLANK }); }} className="btn btn-primary btn-sm">+ {t.add}</button>
        )}
      </SectionTitle>
      {flash && <Notice tone={flash.tone}>{flash.text}</Notice>}
      {!isSuper && <Notice>{t.readOnly}</Notice>}

      {draft && (
        <section className="card space-y-5 p-5" aria-label={draft.id ? t.edit : t.add}>
          <div className="grid gap-3 sm:grid-cols-2">
            {(["nameAr", "nameEn", "descAr", "descEn"] as const).map((k) => (
              <label key={k} className="text-sm">
                <span className="mb-1 block font-semibold text-navy">{t[k]}</span>
                <input className="field w-full" dir={k.endsWith("Ar") ? "rtl" : "ltr"} maxLength={k.startsWith("name") ? 80 : 500} value={draft[k]} disabled={!isSuper || busy} onChange={(e) => setDraft({ ...draft, [k]: e.target.value })} />
              </label>
            ))}
          </div>
          <label className="flex items-center gap-2 text-sm font-semibold text-navy">
            <input type="checkbox" checked={draft.active} disabled={!isSuper || busy} onChange={(e) => setDraft({ ...draft, active: e.target.checked })} className="h-4 w-4 accent-[var(--color-brand)]" />
            {t.active}
          </label>
          <div>
            <h3 className="font-bold text-navy">{t.matrix}</h3>
            <p className="text-xs text-slate">{t.implied}</p>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              {orderedSections(data.catalogue).map((section) => [section, data.catalogue[section]] as const).map(([section, actions]) => (
                <fieldset key={section} className="rounded-xl border border-line p-3">
                  <legend className="px-1 text-sm font-bold text-navy">{sectionName(section)}</legend>
                  <div className="space-y-1.5">
                    {actions.map((action) => {
                      const on = !!draft.permissions[section]?.includes(action);
                      return (
                        <label key={action} className="flex items-start gap-2 text-sm text-ink">
                          <input
                            type="checkbox"
                            checked={on}
                            disabled={!isSuper || busy}
                            className="mt-1 h-4 w-4 shrink-0 accent-[var(--color-brand)]"
                            onChange={() => {
                              const next = on ? (draft.permissions[section] ?? []).filter((x) => x !== action) : [...(draft.permissions[section] ?? []), action];
                              const permissions = { ...draft.permissions, [section]: next };
                              if (!next.length) delete permissions[section];
                              setDraft({ ...draft, permissions });
                            }}
                          />
                          {actionLabels[section]?.[action] ?? action}
                        </label>
                      );
                    })}
                  </div>
                </fieldset>
              ))}
            </div>
          </div>
          <div className="flex flex-wrap gap-3">
            {isSuper && <button type="button" disabled={busy} onClick={save} className="btn btn-primary btn-sm">{t.save}</button>}
            <button type="button" disabled={busy} onClick={() => setDraft(null)} className="btn btn-outline btn-sm">{t.close}</button>
          </div>
        </section>
      )}

      <section>
        <h3 className="text-lg font-bold text-navy">{t.adminTitle}</h3>
        <ul className="mt-3 grid gap-4 md:grid-cols-2">
          {data.roles.map((r) => (
            <li key={r.id} className={cn("card flex flex-col p-5", !r.active && "opacity-70")}>
              <div className="flex flex-wrap items-center gap-2">
                <h4 className="font-bold text-navy">{roleName(r, locale)}</h4>
                {r.system && <span className="rounded-md bg-mist px-2 py-0.5 text-xs font-semibold text-slate">{t.builtIn}</span>}
                {!r.active && <span className="rounded-md bg-gold/10 px-2 py-0.5 text-xs font-semibold text-gold-600">{t.off}</span>}
              </div>
              {(locale === "ar" ? r.descAr || r.descEn : r.descEn || r.descAr) && <p className="mt-1 text-sm leading-6 text-slate">{locale === "ar" ? r.descAr || r.descEn : r.descEn || r.descAr}</p>}
              <p className="mt-2 text-sm text-navy">{summary(r.permissions) || t.none}</p>
              <div className="mt-auto flex flex-wrap items-center gap-2 pt-4">
                <span className="flex-1 text-xs text-slate">{t.members.replace("{n}", String(r.members))}</span>
                <button type="button" onClick={() => open(r)} className="btn btn-outline btn-sm">{isSuper ? t.edit : t.view}</button>
                {isSuper && !r.system && (
                  <button type="button" disabled={busy} onClick={() => window.confirm(t.confirmDelete.replace("{name}", roleName(r, locale))) && run(() => rpc("exam_role_delete", { p_id: r.id }), t.deleted)} className="rounded-lg px-2.5 py-1 text-sm font-semibold text-gold-600 hover:bg-gold/10">
                    {t.remove}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h3 className="text-lg font-bold text-navy">{t.baseTitle}</h3>
        <dl className="card mt-3 divide-y divide-line">
          {(["ADMIN", "STAFF", "INSTRUCTOR", "LEARNER"] as Role[]).map((r) => (
            <div key={r} className="flex flex-wrap gap-x-4 gap-y-1 p-4 text-sm">
              <dt className="w-32 font-bold text-navy">{labels.roles[r]}</dt>
              <dd className="min-w-0 flex-1 text-slate">{t.base[r]}</dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}
