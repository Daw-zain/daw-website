/**
 * GIFT (Moodle's text format) and Aiken (simple multiple choice).
 *   GIFT: multiple choice (one / several right, with % weights), true/false, short answer, numeric (value:tolerance,
 *         min..max), matching, essay, ::titles::, $CATEGORY, // comments, #feedback, ####general feedback.
 *         Not representable in GIFT: ordering, cloze, drag & drop, hotspot (refused on export, reported).
 *   Aiken: one-right-answer multiple choice only.
 */
import type { Item } from "../bank";
import { htmlToText } from "./html";
import { categoryFromPath } from "./moodle";
import { blankImport, inLang, item, pickLang, type ExportQuestion, type ExportResult, type ImportQuestion, type ParseResult, type TextLang } from "./types";

/* ───────────── GIFT ───────────── */

/** index of the next unescaped char from `from` */
function findUnescaped(s: string, ch: string, from = 0): number {
  for (let i = from; i < s.length; i++) {
    if (s[i] === "\\") i++;
    else if (s.startsWith(ch, i)) return i;
  }
  return -1;
}
const giftUnesc = (s: string) => s.replace(/\\n/g, "\n").replace(/\\([~=#{}:\\])/g, "$1").trim();
const giftText = (s: string, html: boolean) => (html ? htmlToText(giftUnesc(s)) : giftUnesc(s));

type Tok = { mark: "=" | "~"; weight: number | null; text: string; feedback: string };
function giftTokens(body: string): Tok[] {
  const toks: Tok[] = [];
  let cur: { mark: "=" | "~"; raw: string } | null = null;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === "\\" && i + 1 < body.length) {
      if (cur) cur.raw += c + body[i + 1];
      i++;
    } else if (c === "=" || c === "~") {
      if (cur) toks.push(finish(cur));
      cur = { mark: c, raw: "" };
    } else if (cur) cur.raw += c;
  }
  if (cur) toks.push(finish(cur));
  return toks;
  function finish(t: { mark: "=" | "~"; raw: string }): Tok {
    let raw = t.raw.trim();
    let weight: number | null = null;
    const m = raw.match(/^%(-?\d+(?:\.\d+)?)%/);
    if (m) {
      weight = Number(m[1]);
      raw = raw.slice(m[0].length);
    }
    const h = findUnescaped(raw, "#");
    return { mark: t.mark, weight, text: h >= 0 ? raw.slice(0, h) : raw, feedback: h >= 0 ? raw.slice(h + 1) : "" };
  }
}

/** blocks of one question each: blank lines separate them, unless a {…} is still open */
function giftBlocks(src: string): { text: string; line: number }[] {
  const lines = src.replace(/^﻿/, "").replace(/\r\n?/g, "\n").split("\n");
  const out: { text: string; line: number }[] = [];
  let buf: string[] = [];
  let start = 1;
  let depth = 0;
  const flush = () => {
    const t = buf.join("\n").trim();
    if (t) out.push({ text: t, line: start });
    buf = [];
  };
  lines.forEach((ln, i) => {
    if (/^\s*\/\//.test(ln)) return;
    if (!ln.trim() && depth === 0) {
      flush();
      start = i + 2;
      return;
    }
    if (!buf.length) start = i + 1;
    buf.push(ln);
    for (let k = 0; k < ln.length; k++) {
      if (ln[k] === "\\") k++;
      else if (ln[k] === "{") depth++;
      else if (ln[k] === "}") depth = Math.max(0, depth - 1);
    }
  });
  flush();
  return out;
}

export function parseGift(src: string, lang: TextLang = "auto"): ParseResult {
  const res: ParseResult = { questions: [], issues: [] };
  let category: ImportQuestion["category"];
  for (const b of giftBlocks(src)) {
    let t = b.text;
    const source = `L${b.line}`;
    const cat = t.match(/^\$CATEGORY:\s*(.+)$/m);
    if (cat && t.trim().startsWith("$CATEGORY")) {
      category = categoryFromPath(cat[1]);
      t = t.replace(/^\$CATEGORY:.*$/m, "").trim();
      if (!t) continue;
    }
    let title = "";
    const tm = t.match(/^::((?:\\.|[^:])*)::/);
    if (tm) {
      title = giftUnesc(tm[1]);
      t = t.slice(tm[0].length).trim();
    }
    let html = false;
    const fm = t.match(/^\[(html|plain|moodle|markdown)\]/i);
    if (fm) {
      html = fm[1].toLowerCase() === "html";
      t = t.slice(fm[0].length);
    }
    const open = findUnescaped(t, "{");
    const close = open >= 0 ? findUnescaped(t, "}", open + 1) : -1;
    const src2 = `${source}${title ? ` · ${title.slice(0, 50)}` : ""}`;
    if (open < 0 || close < 0) {
      res.issues.push({ source: src2, reason: "no_answer_block" });
      continue;
    }
    const after = t.slice(close + 1).trim();
    const stemRaw = t.slice(0, open).trim() + (after ? ` _____ ${after}` : "");
    const stem = giftText(stemRaw, html);
    const L = pickLang(lang, stem);
    let body = t.slice(open + 1, close).trim();
    let genFb = "";
    const g = findUnescaped(body, "####");
    if (g >= 0) {
      genFb = giftText(body.slice(g + 4), html);
      body = body.slice(0, g).trim();
    }
    const make = (type: ImportQuestion["type"]) => {
      const q = blankImport(type, L, stem);
      if (genFb) q[L === "ar" ? "feedbackAr" : "feedbackEn"] = genFb;
      q.category = category;
      return q;
    };
    const warnings: string[] = [];
    const push = (q: ImportQuestion) => res.questions.push({ q, source: src2, warnings, files: [] });

    if (!stem) {
      res.issues.push({ source: src2, reason: "no_stem" });
    } else if (body === "") {
      push(make("ESSAY"));
    } else if (/^(T|TRUE|F|FALSE)(\s*#.*)?$/is.test(body)) {
      const q = make("TRUE_FALSE");
      q.answer = { value: /^T/i.test(body) };
      push(q);
    } else if (body.startsWith("#")) {
      const first = giftTokens("=" + body.slice(1).replace(/^\s*=/, "")).find((x) => x.weight === null || x.weight >= 100);
      const v = (first?.text ?? "").trim();
      const range = v.match(/^(-?[\d.]+)\s*\.\.\s*(-?[\d.]+)$/);
      const tol = v.match(/^(-?[\d.]+)\s*:\s*([\d.]+)$/);
      const q = make("NUMERIC");
      if (range) q.answer = { value: (Number(range[1]) + Number(range[2])) / 2, tolerance: Math.abs(Number(range[2]) - Number(range[1])) / 2 };
      else if (tol) q.answer = { value: Number(tol[1]), tolerance: Number(tol[2]) };
      else if (v !== "" && Number.isFinite(Number(v))) q.answer = { value: Number(v), tolerance: 0 };
      else {
        res.issues.push({ source: src2, reason: "no_correct_answer" });
        continue;
      }
      push(q);
    } else if (findUnescaped(body, "->") >= 0) {
      const toks = giftTokens(body).filter((x) => x.mark === "=");
      const rights: Item[] = [];
      const pairs: { l: Item; r: string }[] = [];
      for (const tk of toks) {
        const k = findUnescaped(tk.text, "->");
        if (k < 0) continue;
        const left = giftText(tk.text.slice(0, k), html);
        const rightT = giftText(tk.text.slice(k + 2), html);
        let r = rights.find((x) => (x.textAr || x.textEn) === rightT);
        if (!r) rights.push((r = item(rightT, L)));
        if (left) pairs.push({ l: item(left, L), r: r.id });
      }
      if (pairs.length < 2 || new Set(pairs.map((p) => p.r)).size < pairs.length) {
        res.issues.push({ source: src2, reason: pairs.length < 2 ? "too_few_items" : "matching_shared_answers" });
        continue;
      }
      const q = make("MATCHING");
      q.content = { left: pairs.map((p) => p.l), right: rights };
      q.answer = { pairs: Object.fromEntries(pairs.map((p) => [p.l.id, p.r])) };
      q.scoring = { mode: "PARTIAL" };
      push(q);
    } else {
      const toks = giftTokens(body);
      const hasWrong = toks.some((x) => x.mark === "~" && !(x.weight && x.weight > 0));
      if (!hasWrong && toks.every((x) => x.mark === "=")) {
        const q = make("SHORT");
        q.answer = { accepted: toks.filter((x) => x.weight === null || x.weight >= 100).map((x) => giftText(x.text, html)).filter(Boolean), caseSensitive: false };
        if (toks.some((x) => x.weight !== null && x.weight < 100)) warnings.push("partial_credit_dropped");
        push(q);
        continue;
      }
      const opts = toks.map((x) => ({ ...item(giftText(x.text, html), L), x }));
      const positive = opts.filter((o) => (o.x.mark === "=" && o.x.weight === null) || (o.x.weight ?? 0) > 0);
      const isMulti = positive.length > 1 || opts.some((o) => o.x.mark === "~" && (o.x.weight ?? 0) > 0 && (o.x.weight ?? 0) < 100);
      const q = make(isMulti ? "MULTI" : "MCQ");
      q.content = { options: opts.map(({ id, textAr, textEn }) => ({ id, textAr, textEn })) };
      for (const o of opts) if (o.x.feedback.trim()) q.optionRationale[o.id] = { [L]: giftText(o.x.feedback, html) };
      if (!positive.length) {
        res.issues.push({ source: src2, reason: "no_correct_answer" });
        continue;
      }
      q.answer = { correct: positive.map((o) => o.id) };
      if (isMulti) q.scoring = { mode: opts.some((o) => (o.x.weight ?? 0) < 0) ? "PARTIAL_PENALTY" : "PARTIAL" };
      push(q);
    }
  }
  return res;
}

const giftEsc = (s: string) => s.replace(/([~=#{}:\\])/g, "\\$1").replace(/\r?\n/g, "\\n");

export function exportGift(qs: ExportQuestion[], lang: "ar" | "en"): ExportResult {
  const T = (ar?: string, en?: string) => inLang(ar, en, lang);
  const out: string[] = ["// GIFT — exported from Al Daleel exam bank"];
  const skipped: ExportResult["skipped"] = [];
  let lastCat = "";
  let exported = 0;
  for (const q of qs) {
    if (!["MCQ", "MULTI", "TRUE_FALSE", "NUMERIC", "SHORT", "ESSAY", "MATCHING"].includes(q.type)) {
      skipped.push({ id: q.id, type: q.type, reason: "type_not_supported" });
      continue;
    }
    const cp = ["$course$", "top", q.category?.domain, q.category?.topic, q.category?.subtopic].filter(Boolean).join("/");
    if (cp !== lastCat) {
      out.push("", `$CATEGORY: ${cp}`);
      lastCat = cp;
    }
    const stem = giftEsc(T(q.stemAr, q.stemEn));
    const fb = T(q.feedbackAr, q.feedbackEn);
    const gfb = fb ? ` ####${giftEsc(fb)}` : "";
    const title = `::${giftEsc(T(q.stemAr, q.stemEn).replace(/\s+/g, " ").slice(0, 40))}::`;
    let ans = "";
    switch (q.type) {
      case "MCQ":
      case "MULTI": {
        const correct = q.answer.correct ?? [];
        const n = Math.max(1, correct.length);
        ans = (q.content.options ?? [])
          .map((o) => {
            const ok = correct.includes(o.id);
            const r = q.optionRationale[o.id];
            const why = inLang(r?.ar, r?.en, lang);
            const w = q.type === "MCQ" ? (ok ? "=" : "~") : ok ? `~%${Math.round((100 / n) * 100000) / 100000}%` : q.scoring.mode === "PARTIAL_PENALTY" ? `~%-${Math.round((100 / n) * 100000) / 100000}%` : "~%0%";
            return `\n  ${w}${giftEsc(T(o.textAr, o.textEn))}${why ? `#${giftEsc(why)}` : ""}`;
          })
          .join("");
        ans += "\n";
        break;
      }
      case "TRUE_FALSE":
        ans = q.answer.value ? "TRUE" : "FALSE";
        break;
      case "NUMERIC":
        ans = `#${q.answer.value}${q.answer.tolerance ? `:${q.answer.tolerance}` : ""}`;
        break;
      case "SHORT":
        ans = (q.answer.accepted ?? []).filter((x) => x.trim()).map((x) => `=${giftEsc(x.trim())}`).join(" ");
        break;
      case "ESSAY":
        ans = "";
        break;
      case "MATCHING": {
        const used = new Set<string>();
        ans = (q.content.left ?? [])
          .map((l) => {
            const r = (q.content.right ?? []).find((x) => x.id === q.answer.pairs?.[l.id]);
            if (r) used.add(r.id);
            return `\n  =${giftEsc(T(l.textAr, l.textEn))} -> ${giftEsc(r ? T(r.textAr, r.textEn) : "")}`;
          })
          .join("");
        ans += (q.content.right ?? []).filter((x) => !used.has(x.id)).map((r) => `\n  = -> ${giftEsc(T(r.textAr, r.textEn))}`).join("") + "\n";
        break;
      }
    }
    out.push("", `${title}${stem} {${ans}${gfb}}`);
    exported++;
  }
  return { text: out.join("\n") + "\n", mime: "text/plain", ext: "gift.txt", exported, skipped };
}

/* ───────────── Aiken ───────────── */

export function parseAiken(src: string, lang: TextLang = "auto"): ParseResult {
  const res: ParseResult = { questions: [], issues: [] };
  const lines = src.replace(/^﻿/, "").replace(/\r\n?/g, "\n").split("\n");
  let stemLines: string[] = [];
  let opts: { letter: string; text: string }[] = [];
  let start = 1;
  const reset = (i: number) => {
    stemLines = [];
    opts = [];
    start = i + 2;
  };
  lines.forEach((raw, i) => {
    const ln = raw.trim();
    if (!ln) {
      if (!opts.length && !stemLines.length) start = i + 2;
      return;
    }
    const opt = ln.match(/^([A-Za-z])[.)]\s+(.+)$/);
    const ans = ln.match(/^ANSWER\s*:\s*([A-Za-z])\s*$/i);
    if (ans) {
      const stem = stemLines.join("\n").trim();
      const source = `L${start}`;
      const right = opts.find((o) => o.letter.toUpperCase() === ans[1].toUpperCase());
      if (!stem || opts.length < 2) res.issues.push({ source, reason: "too_few_items" });
      else if (!right) res.issues.push({ source, reason: "no_correct_answer" });
      else {
        const L = pickLang(lang, stem);
        const q = blankImport("MCQ", L, stem);
        const items = opts.map((o) => item(o.text, L));
        q.content = { options: items };
        q.answer = { correct: [items[opts.indexOf(right)].id] };
        res.questions.push({ q, source, warnings: [], files: [] });
      }
      reset(i);
    } else if (opt && stemLines.length) {
      opts.push({ letter: opt[1], text: opt[2].trim() });
    } else if (opts.length) {
      // text after options without ANSWER line → broken question
      res.issues.push({ source: `L${start}`, reason: "no_correct_answer" });
      reset(i - 1);
      stemLines = [ln];
      start = i + 1;
    } else stemLines.push(ln);
  });
  if (stemLines.length || opts.length) res.issues.push({ source: `L${start}`, reason: "no_correct_answer" });
  return res;
}

export function exportAiken(qs: ExportQuestion[], lang: "ar" | "en"): ExportResult {
  const T = (ar?: string, en?: string) => inLang(ar, en, lang).replace(/\s*\r?\n\s*/g, " ").trim();
  const out: string[] = [];
  const skipped: ExportResult["skipped"] = [];
  for (const q of qs) {
    const opts = q.content.options ?? [];
    if (q.type !== "MCQ" || opts.length > 26) {
      skipped.push({ id: q.id, type: q.type, reason: "type_not_supported" });
      continue;
    }
    const right = opts.findIndex((o) => o.id === q.answer.correct?.[0]);
    out.push(T(q.stemAr, q.stemEn), ...opts.map((o, i) => `${String.fromCharCode(65 + i)}. ${T(o.textAr, o.textEn)}`), `ANSWER: ${String.fromCharCode(65 + Math.max(0, right))}`, "");
  }
  return { text: out.join("\n"), mime: "text/plain", ext: "aiken.txt", exported: qs.length - skipped.length, skipped };
}
