"use client";

import { useState } from "react";
import { ExamError, rpc } from "@/lib/exams/client";
import { bankErrorKey, catName, stem, type Category } from "@/lib/exams/bank";
import { removeFiles } from "./AssetManager";
import { Notice, type ExamLabels } from "./ExamShell";

export type BulkCan = { edit: boolean; delete: boolean; export: boolean };
type Action = "copy" | "delete" | "status" | "difficulty" | "category";
type Failed = { id: string; stemAr: string | null; stemEn: string | null; reason: string };
type Outcome = { action: Action; done: number; unchanged: number; failed: Failed[]; stopped: string | null };

const CHUNK = 100; // the database accepts at most 100 questions per request
/** deleting more questions than this asks to type the number */
const TYPE_TO_CONFIRM = 10;

/**
 * Selection tools of the question list: select this page / every question matching the filter, and
 * apply one action to the selection. Permissions and the rules of each action are enforced in the database.
 */
export function BankBulkBar({
  programId,
  picked,
  pageIds,
  total,
  filter,
  categories,
  can,
  onPick,
  onExport,
  onChanged,
  locale,
  labels,
}: {
  programId: string;
  picked: string[];
  pageIds: string[];
  total: number;
  filter: Record<string, unknown>;
  categories: Category[];
  can: BulkCan;
  onPick: (ids: string[]) => void;
  onExport: () => void;
  onChanged: (action: Action) => Promise<void>;
  locale: string;
  labels: ExamLabels;
}) {
  const b = labels.bank;
  const t = b.bulk;
  const [busy, setBusy] = useState<{ done: number; n: number } | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  const reason = (message: string) => {
    const key = ["question_in_exam", "question_in_attempt", "max_100"].find((k) => message.includes(k)) ?? bankErrorKey(new Error(message));
    return (b.errors as Record<string, string>)[key] ?? (message.includes("rate_limited") ? labels.analytics.rateLimited : labels.errorGeneric);
  };

  const pageAll = pageIds.length > 0 && pageIds.every((id) => picked.includes(id));
  const togglePage = (on: boolean) => {
    setOutcome(null);
    setNote(null);
    onPick(on ? [...picked, ...pageIds.filter((id) => !picked.includes(id))] : picked.filter((id) => !pageIds.includes(id)));
  };
  const selectAll = async () => {
    setSelecting(true);
    setOutcome(null);
    setNote(null);
    try {
      const r = await rpc<{ total: number; ids: string[] }>("exam_bank_question_ids", { p_program: programId, p_filter: filter });
      onPick(r.ids);
      if (r.total > r.ids.length) setNote(t.capped.replace("{n}", String(r.ids.length)));
    } catch (e) {
      setNote(reason((e as ExamError).message));
    }
    setSelecting(false);
  };

  const confirmed = (action: Action, label: string) => {
    const n = String(picked.length);
    if (action === "delete") {
      if (picked.length <= TYPE_TO_CONFIRM) return window.confirm(t.confirmDelete.replace("{n}", n));
      const typed = window.prompt(t.typeToDelete.replaceAll("{n}", n));
      // Arabic-Indic digits are accepted too
      const ok = typed?.trim().replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x660)) === n;
      if (!ok && typed !== null) setNote(t.deleteCancelled);
      return ok;
    }
    return window.confirm((action === "copy" ? t.confirmCopy : t.confirm).replace("{action}", label).replace("{n}", n));
  };

  const run = async (action: Action, label: string, args: Record<string, string> = {}) => {
    setOutcome(null);
    setNote(null);
    if (!picked.length || !confirmed(action, label)) return;
    const ids = [...picked];
    const total: Outcome = { action, done: 0, unchanged: 0, failed: [], stopped: null };
    setBusy({ done: 0, n: ids.length });
    for (let i = 0; i < ids.length; i += CHUNK) {
      try {
        const r = await rpc<{ done: number; unchanged: number; failed: Failed[]; paths: string[] }>("exam_bank_question_bulk", { p_program: programId, p_action: action, p_ids: ids.slice(i, i + CHUNK), p_args: args });
        total.done += r.done;
        total.unchanged += r.unchanged;
        total.failed.push(...r.failed);
        // attachment files of deleted questions are removed from storage by the browser
        if (r.paths?.length) await removeFiles(r.paths).catch(() => {});
      } catch (e) {
        total.stopped = reason((e as ExamError).message);
        break;
      }
      setBusy({ done: Math.min(i + CHUNK, ids.length), n: ids.length });
    }
    // after deleting, keep only what could not be deleted selected; after copying, nothing
    if (action === "delete" && !total.stopped) onPick(total.failed.map((f) => f.id));
    else if (action === "delete" || action === "copy") onPick([]);
    await onChanged(action);
    setBusy(null);
    setOutcome(total);
  };

  const button = "rounded-lg border border-line bg-white px-3 py-1.5 font-semibold text-navy transition hover:border-brand/50 disabled:opacity-50";
  const select = "rounded-lg border border-line bg-white px-2 py-1.5 font-semibold text-navy disabled:opacity-50";
  // one line per distinct reason, with a few example questions
  const grouped = new Map<string, Failed[]>();
  for (const f of outcome?.failed ?? []) {
    const k = reason(f.reason);
    grouped.set(k, [...(grouped.get(k) ?? []), f]);
  }

  return (
    <div className="space-y-3">
      {total > 0 && (
        <div className="rounded-xl border border-line bg-mist/60 px-4 py-3 text-sm">
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 font-semibold text-navy">
              <input
                type="checkbox"
                className="h-4 w-4 accent-[var(--color-brand)]"
                checked={pageAll}
                ref={(el) => {
                  if (el) el.indeterminate = !pageAll && pageIds.some((id) => picked.includes(id));
                }}
                disabled={!!busy}
                onChange={(e) => togglePage(e.target.checked)}
              />
              {t.selectPage}
            </label>
            <button type="button" disabled={!!busy || selecting || (picked.length >= total && pageAll)} onClick={selectAll} className={button}>
              {t.selectAll.replace("{n}", String(total))}
            </button>
            {picked.length > 0 && (
              <>
                <span className="font-bold text-navy" role="status">{t.selected.replace("{n}", String(picked.length))}</span>
                <button type="button" disabled={!!busy} onClick={() => onPick([])} className="text-gold-600 hover:underline">{t.clear}</button>
              </>
            )}
          </div>
          {picked.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3">
              <span className="text-slate">{t.actions}</span>
              {can.edit && (
                <>
                  <button type="button" disabled={!!busy} onClick={() => run("status", t.activate, { status: "ACTIVE" })} className={button}>{t.activate}</button>
                  <button type="button" disabled={!!busy} onClick={() => run("status", t.draft, { status: "DRAFT" })} className={button}>{t.draft}</button>
                  <button type="button" disabled={!!busy} onClick={() => run("status", t.disable, { status: "DISABLED" })} className={button}>{t.disable}</button>
                  <select
                    className={select}
                    aria-label={t.difficulty}
                    value=""
                    disabled={!!busy}
                    onChange={(e) => {
                      const d = e.target.value as "EASY" | "MEDIUM" | "HARD";
                      if (d) run("difficulty", b.difficulties[d], { difficulty: d });
                    }}
                  >
                    <option value="">{t.difficulty}</option>
                    {(["EASY", "MEDIUM", "HARD"] as const).map((d) => <option key={d} value={d}>{b.difficulties[d]}</option>)}
                  </select>
                  <select
                    className={`${select} max-w-60`}
                    aria-label={t.category}
                    value=""
                    disabled={!!busy}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (!v) return;
                      const cat = categories.find((c) => c.id === v);
                      run("category", cat ? catName(cat, locale) : t.noCategory, { categoryId: cat?.id ?? "" });
                    }}
                  >
                    <option value="">{t.category}</option>
                    <option value="none">{t.noCategory}</option>
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.kind === "DOMAIN" ? "" : c.kind === "TOPIC" ? "— " : "—— "}
                        {catName(c, locale)}
                      </option>
                    ))}
                  </select>
                  <button type="button" disabled={!!busy} onClick={() => run("copy", t.copy)} className={button}>{t.copy}</button>
                </>
              )}
              {can.export && <button type="button" disabled={!!busy} onClick={onExport} className={button}>{t.export}</button>}
              {can.delete && (
                <button type="button" disabled={!!busy} onClick={() => run("delete", t.delete)} className="rounded-lg border border-gold/40 bg-white px-3 py-1.5 font-semibold text-gold-600 transition hover:bg-gold/10 disabled:opacity-50">
                  {t.delete}
                </button>
              )}
            </div>
          )}
        </div>
      )}
      {busy && <Notice>{t.working.replace("{done}", String(busy.done)).replace("{n}", String(busy.n))}</Notice>}
      {note && <Notice>{note}</Notice>}
      {outcome && (
        <Notice tone={outcome.failed.length || outcome.stopped ? "error" : "success"}>
          <p className="font-semibold">
            {[t.done.replace("{n}", String(outcome.done)), outcome.unchanged ? t.unchanged.replace("{n}", String(outcome.unchanged)) : "", outcome.failed.length ? t.failed.replace("{n}", String(outcome.failed.length)) : ""]
              .filter(Boolean)
              .join(" · ")}
          </p>
          {outcome.stopped && <p>{t.stopped.replace("{reason}", outcome.stopped)}</p>}
          {[...grouped].map(([text, list]) => (
            <details key={text} className="mt-1">
              <summary className="cursor-pointer">{text} ({list.length})</summary>
              <ul className="mt-1 list-disc ps-5">
                {list.slice(0, 20).map((f) => (
                  <li key={f.id} className="line-clamp-1">{stem({ stemAr: f.stemAr ?? "", stemEn: f.stemEn ?? "" }, locale) || f.id}</li>
                ))}
              </ul>
            </details>
          ))}
        </Notice>
      )}
    </div>
  );
}
