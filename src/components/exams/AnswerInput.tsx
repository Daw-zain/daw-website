"use client";

import { useEffect, useState } from "react";
import type { AssetRef, AttemptScenario, PublicQuestion, Response } from "@/lib/exams/attempt";
import { txt } from "@/lib/exams/attempt";
import { cn } from "@/lib/utils";
import type { ExamLabels } from "./ExamShell";
import { signedUrls } from "./AssetManager";
import { ScenarioView } from "./BankScenarios";

/** Images / PDFs of a question or scenario through short-lived signed URLs (storage policy decides access) */
export function useSigned(assets: AssetRef[] | undefined, locale: string) {
  const [out, setOut] = useState<{ url: string; caption: string; pdf: boolean }[]>([]);
  const key = (assets ?? []).map((a) => a.path).join("|");
  useEffect(() => {
    let live = true;
    const list = assets ?? [];
    if (!list.length) return setOut([]);
    signedUrls(list.map((a) => a.path), 1800).then((urls) => {
      if (live) setOut(list.filter((a) => urls[a.path]).map((a) => ({ url: urls[a.path], caption: locale === "ar" ? a.captionAr || a.captionEn : a.captionEn || a.captionAr, pdf: a.kind === "FILE" })));
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- key covers the asset list
  }, [key, locale]);
  return out;
}

export function QuestionMedia({ assets, locale }: { assets: AssetRef[] | undefined; locale: string }) {
  const media = useSigned(assets, locale);
  return (
    <>
      {media.map((m, i) =>
        m.pdf ? (
          <a key={i} href={m.url} target="_blank" rel="noopener" className="mt-3 inline-flex rounded-lg bg-mist px-3 py-2 text-sm font-semibold text-brand">PDF · {m.caption || "↗"}</a>
        ) : (
          <figure key={i} className="mt-3">
            {/* eslint-disable-next-line @next/next/no-img-element -- signed URL from private storage */}
            <img src={m.url} alt={m.caption} className="max-h-96 w-full rounded-lg bg-mist object-contain" draggable={false} />
            {m.caption && <figcaption className="mt-1 text-sm text-slate">{m.caption}</figcaption>}
          </figure>
        ),
      )}
    </>
  );
}

export function AttemptScenarioView({ s, locale, labels }: { s: AttemptScenario; locale: string; labels: ExamLabels }) {
  const media = useSigned(s.images?.filter((a) => a.kind === "IMAGE"), locale);
  return <ScenarioView s={{ ...s, status: "ACTIVE", version: 0 }} locale={locale} labels={labels} images={media.map((m) => ({ url: m.url, caption: m.caption }))} />;
}

/** Answer controls for one public question (controlled: value + onChange) */
export function AnswerInput({ data, value, onChange, locale, labels, disabled }: { data: PublicQuestion; value: Response; onChange: (r: Response) => void; locale: string; labels: ExamLabels; disabled?: boolean }) {
  const at = labels.attempt;
  const bk = labels.bank.editor;
  const r = value ?? {};
  const [text, setText] = useState(r.text ?? "");
  useEffect(() => setText(r.text ?? ""), [r.text]);
  const order = r.order ?? (data.items ?? []).map((i) => i.id);
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;

  switch (data.type) {
    case "MCQ":
    case "MULTI": {
      const multi = data.type === "MULTI";
      const chosen = multi ? r.choices ?? [] : r.choice ? [r.choice] : [];
      return (
        <div>
          {multi && data.selectCount ? <p className="mb-2 text-sm font-semibold text-brand">{at.chooseN.replace("{n}", String(data.selectCount))}</p> : null}
          <ul className="space-y-2">
            {(data.options ?? []).map((o, i) => {
              const on = chosen.includes(o.id);
              return (
                <li key={o.id}>
                  <label className={cn("flex cursor-pointer items-start gap-3 rounded-xl border px-4 py-3 transition", on ? "border-brand bg-brand/5" : "border-line hover:border-brand/40", disabled && "cursor-default")}>
                    <input
                      type={multi ? "checkbox" : "radio"}
                      checked={on}
                      disabled={disabled}
                      onChange={() => onChange(multi ? { choices: on ? chosen.filter((x) => x !== o.id) : [...chosen, o.id] } : { choice: o.id })}
                      className="mt-1 h-4 w-4 accent-[var(--color-brand)]"
                    />
                    <span className="shrink-0 font-semibold text-slate" dir="ltr">{String.fromCharCode(65 + i)}.</span>
                    <span className="leading-7">{txt(o, locale)}</span>
                  </label>
                </li>
              );
            })}
          </ul>
        </div>
      );
    }
    case "TRUE_FALSE":
      return (
        <div className="flex flex-wrap gap-3">
          {([true, false] as const).map((v) => (
            <label key={String(v)} className={cn("flex cursor-pointer items-center gap-2 rounded-xl border px-6 py-3", r.value === v ? "border-brand bg-brand/5" : "border-line")}>
              <input type="radio" checked={r.value === v} disabled={disabled} onChange={() => onChange({ value: v })} className="h-4 w-4 accent-[var(--color-brand)]" />
              {v ? bk.tfTrue : bk.tfFalse}
            </label>
          ))}
        </div>
      );
    case "NUMERIC":
      return (
        <div className="flex items-center gap-2">
          <input
            type="number"
            inputMode="decimal"
            step="any"
            disabled={disabled}
            value={typeof r.value === "number" ? r.value : ""}
            onChange={(e) => onChange(e.target.value === "" ? null : { value: Number(e.target.value) })}
            placeholder={at.typeNumber}
            className="field w-56"
            dir="ltr"
          />
          {(locale === "ar" ? data.unitAr || data.unitEn : data.unitEn || data.unitAr) && <span className="text-slate">{locale === "ar" ? data.unitAr || data.unitEn : data.unitEn || data.unitAr}</span>}
        </div>
      );
    case "SHORT":
      return <input value={text} disabled={disabled} maxLength={500} onChange={(e) => { setText(e.target.value); onChange(e.target.value.trim() ? { text: e.target.value } : null); }} className="field max-w-xl" aria-label={at.yourAnswer} />;
    case "ESSAY":
      return (
        <div>
          <textarea value={text} disabled={disabled} rows={10} maxLength={20000} onChange={(e) => { setText(e.target.value); onChange(e.target.value.trim() ? { text: e.target.value } : null); }} className="field" aria-label={at.yourAnswer} />
          <p className={cn("mt-1 text-xs", data.maxWords && words > data.maxWords ? "text-gold-600" : "text-slate")} dir="ltr">
            {words}{data.minWords || data.maxWords ? ` / ${data.minWords ?? 0}–${data.maxWords ?? "∞"}` : ""} {at.words}
          </p>
        </div>
      );
    case "ORDERING": {
      const byId = Object.fromEntries((data.items ?? []).map((i) => [i.id, i]));
      const move = (i: number, d: -1 | 1) => {
        const n = [...order];
        const j = i + d;
        if (j < 0 || j >= n.length) return;
        [n[i], n[j]] = [n[j], n[i]];
        onChange({ order: n });
      };
      return (
        <ol className="space-y-2">
          {order.map((id, i) => (
            <li key={id} className="flex items-center gap-3 rounded-xl border border-line bg-white px-4 py-2.5">
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-mist text-sm font-bold text-navy">{i + 1}</span>
              <span className="flex-1 leading-7">{txt(byId[id], locale)}</span>
              <button type="button" disabled={disabled || i === 0} onClick={() => move(i, -1)} className="rounded-lg px-2.5 py-1.5 text-slate hover:bg-mist disabled:opacity-30" aria-label={bk.up}>↑</button>
              <button type="button" disabled={disabled || i === order.length - 1} onClick={() => move(i, 1)} className="rounded-lg px-2.5 py-1.5 text-slate hover:bg-mist disabled:opacity-30" aria-label={bk.down}>↓</button>
            </li>
          ))}
        </ol>
      );
    }
    case "MATCHING":
      return (
        <ul className="space-y-2">
          {(data.left ?? []).map((l) => (
            <li key={l.id} className="grid items-center gap-2 rounded-xl border border-line px-4 py-2.5 sm:grid-cols-2">
              <span className="leading-7">{txt(l, locale)}</span>
              <select
                value={r.pairs?.[l.id] ?? ""}
                disabled={disabled}
                onChange={(e) => {
                  const pairs = { ...(r.pairs ?? {}) };
                  if (e.target.value) pairs[l.id] = e.target.value;
                  else delete pairs[l.id];
                  onChange(Object.keys(pairs).length ? { pairs } : null);
                }}
                className="field"
              >
                <option value="">{at.selectMatch}</option>
                {(data.right ?? []).map((x) => <option key={x.id} value={x.id}>{txt(x, locale)}</option>)}
              </select>
            </li>
          ))}
        </ul>
      );
  }
  return null;
}
