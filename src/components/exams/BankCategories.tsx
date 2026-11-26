"use client";

import { useState } from "react";
import { rpc } from "@/lib/exams/client";
import { bankErrorKey, catName, type Category, type CategoryKind } from "@/lib/exams/bank";
import { Notice, type ExamLabels } from "./ExamShell";

const CHILD: Record<CategoryKind, CategoryKind | null> = { DOMAIN: "TOPIC", TOPIC: "SUBTOPIC", SUBTOPIC: null };

/** Domain → Topic → Subtopic tree of one course bank */
export function BankCategories({
  programId,
  categories,
  canManage,
  locale,
  labels,
  onChanged,
}: {
  programId: string;
  categories: Category[];
  canManage: boolean;
  locale: string;
  labels: ExamLabels;
  onChanged: () => Promise<void>;
}) {
  const b = labels.bank;
  const c = b.categories;
  const [form, setForm] = useState<{ mode: "add" | "rename"; kind: CategoryKind; parentId: string | null; id?: string; nameAr: string; nameEn: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      setForm(null);
      await onChanged();
    } catch (e) {
      setError((b.errors as Record<string, string>)[bankErrorKey(e)] ?? labels.errorGeneric);
    } finally {
      setBusy(false);
    }
  };

  const save = () =>
    form &&
    run(() =>
      rpc("exam_bank_category_save", {
        p_program: programId,
        p_cat: form.mode === "rename" ? { id: form.id, nameAr: form.nameAr, nameEn: form.nameEn } : { kind: form.kind, parentId: form.parentId, nameAr: form.nameAr, nameEn: form.nameEn },
      }),
    );

  const renderForm = (at: string | null) =>
    form && (form.mode === "rename" ? form.id === at : form.parentId === at) ? (
      <div className="mt-2 flex flex-wrap items-end gap-2 rounded-xl border border-brand/30 bg-brand/5 p-3">
        <span className="w-full text-xs font-semibold text-brand">{form.mode === "rename" ? c.rename : `${c.addChild} ${b.kinds[form.kind]}`}</span>
        <input autoFocus value={form.nameAr} onChange={(e) => setForm({ ...form, nameAr: e.target.value })} placeholder={c.nameAr} className="field min-w-0 flex-1 basis-40 py-2" dir="rtl" />
        <input value={form.nameEn} onChange={(e) => setForm({ ...form, nameEn: e.target.value })} placeholder={c.nameEn} className="field min-w-0 flex-1 basis-40 py-2" dir="ltr" />
        <button type="button" onClick={save} disabled={busy} className="btn btn-primary btn-sm">{c.save}</button>
        <button type="button" onClick={() => setForm(null)} className="btn btn-outline btn-sm">{c.cancel}</button>
      </div>
    ) : null;

  const renderNode = (cat: Category, depth: number) => {
    const kids = categories.filter((x) => x.parentId === cat.id);
    const child = CHILD[cat.kind];
    return (
      <li key={cat.id} className={depth ? "ms-5 border-s border-line ps-4" : ""}>
        <div className="flex flex-wrap items-center gap-2 py-1.5">
          <span className="rounded-md bg-mist px-2 py-0.5 text-[11px] font-semibold text-slate">{b.kinds[cat.kind]}</span>
          <span className="font-semibold text-navy">{catName(cat, locale)}</span>
          {cat.nameEn && locale === "ar" && <span className="text-xs text-slate" dir="ltr">{cat.nameEn}</span>}
          <span className="text-xs text-slate">· {cat.questions} {c.questions}</span>
          {canManage && (
            <span className="ms-auto flex gap-1 text-xs">
              {child && (
                <button type="button" onClick={() => setForm({ mode: "add", kind: child, parentId: cat.id, nameAr: "", nameEn: "" })} className="rounded-lg px-2 py-1 font-semibold text-brand hover:bg-brand/10">
                  + {b.kinds[child]}
                </button>
              )}
              <button type="button" onClick={() => setForm({ mode: "rename", kind: cat.kind, parentId: cat.parentId, id: cat.id, nameAr: cat.nameAr, nameEn: cat.nameEn })} className="rounded-lg px-2 py-1 text-slate hover:bg-mist">
                {c.rename}
              </button>
              <button type="button" onClick={() => window.confirm(c.confirmDelete) && run(() => rpc("exam_bank_category_delete", { p_id: cat.id }))} className="rounded-lg px-2 py-1 text-gold-600 hover:bg-gold/10">
                {c.delete}
              </button>
            </span>
          )}
        </div>
        {renderForm(cat.id)}
        {kids.length > 0 && (
          <ul>
            {kids.map((k) => renderNode(k, depth + 1))}
          </ul>
        )}
      </li>
    );
  };

  const domains = categories.filter((x) => x.kind === "DOMAIN");
  return (
    <div className="card p-5 sm:p-6">
      <p className="text-sm text-slate">{c.intro}</p>
      {error && <div className="mt-4"><Notice tone="error">{error}</Notice></div>}
      {domains.length === 0 ? <p className="mt-5 text-slate">{c.none}</p> : (
        <ul className="mt-4 divide-y divide-line">
          {domains.map((d) => renderNode(d, 0))}
        </ul>
      )}
      {canManage && (
        <div className="mt-5">
          {form?.mode === "add" && form.kind === "DOMAIN" ? renderForm(null) : (
            <button type="button" onClick={() => setForm({ mode: "add", kind: "DOMAIN", parentId: null, nameAr: "", nameEn: "" })} className="btn btn-outline btn-sm">
              + {c.addDomain}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
