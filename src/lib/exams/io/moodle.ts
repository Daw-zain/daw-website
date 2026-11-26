/**
 * Moodle XML — the main import/export format.
 *   import: multichoice (single/multi), truefalse, numerical, shortanswer, essay, matching (→ MATCHING, or DRAGDROP
 *           when several items share an answer), ordering (plugin), gapselect / ddwtos (→ CLOZE drop-downs),
 *           multianswer / "Cloze" (→ CLOZE), categories, tags, general + answer feedback, embedded images/PDFs.
 *   export: everything above; HOTSPOT and DRAGDROP-with-distractors have no Moodle equivalent and are skipped (reported).
 * Our own exports also carry a <daleel> element (ignored by Moodle) with the full bilingual question, so a
 * round trip through this format loses nothing.
 */
import type { Item, QuestionType } from "../bank";
import { escHtml, htmlToText, textToHtml } from "./html";
import {
  blankImport,
  inLang,
  item,
  mimeOf,
  pickLang,
  type ExportQuestion,
  type ExportResult,
  type ImportFile,
  type ImportQuestion,
  type ParseIssue,
  type ParsedQuestion,
  type ParseResult,
  type TextLang,
} from "./types";
import { cdata, escXml, kid, kids, parseXml, path, txtOf, type XNode } from "./xml";

const IGNORED_CATEGORY = /^(\$[a-z0-9]+\$|top|default for .*|افتراضي ل.*)$/i;

/** "$course$/top/Domain/Topic" → { domain, topic } (the last three meaningful levels) */
export function categoryFromPath(p: string): ImportQuestion["category"] {
  const parts = p.split("/").map((s) => s.trim()).filter((s) => s && !IGNORED_CATEGORY.test(s)).slice(-3);
  if (!parts.length) return undefined;
  return { domain: parts[0], topic: parts[1], subtopic: parts[2] };
}

const num = (s: string | undefined) => {
  const v = Number(String(s ?? "").trim().replace(",", "."));
  return Number.isFinite(v) ? v : NaN;
};

/** embedded <file> elements of a text node → importable attachments (images and PDFs only) */
function filesOf(n: XNode | undefined, warnings: string[]): ImportFile[] {
  return kids(n, "file").flatMap((f) => {
    const name = f.attrs.name ?? "";
    const mime = mimeOf(name);
    if (!mime || (f.attrs.encoding ?? "base64") !== "base64") {
      warnings.push(`file_skipped:${name}`);
      return [];
    }
    return [{ name, mime, base64: f.text.replace(/\s+/g, "") }];
  });
}

/** split a Moodle "Cloze" answer list on unescaped ~ */
function splitCloze(s: string): string[] {
  const out: string[] = [];
  let cur = "";
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "\\" && i + 1 < s.length) {
      cur += s[i] + s[i + 1];
      i++;
    } else if (s[i] === "~") {
      out.push(cur);
      cur = "";
    } else cur += s[i];
  }
  out.push(cur);
  return out;
}
const unesc = (s: string) => s.replace(/\\(.)/g, "$1");

type ClozeAnswer = { text: string; correct: boolean; feedback: string };
function parseClozeAnswers(body: string): ClozeAnswer[] {
  return splitCloze(body).map((raw) => {
    let s = raw;
    let fraction = 0;
    if (s.startsWith("=")) {
      fraction = 100;
      s = s.slice(1);
    } else {
      const m = s.match(/^%(-?\d+(?:\.\d+)?)%/);
      if (m) {
        fraction = Number(m[1]);
        s = s.slice(m[0].length);
      }
    }
    // "#feedback" (unescaped #)
    let fb = "";
    const hm = s.match(/^((?:\\.|[^#])*)#(.*)$/);
    if (hm) {
      s = hm[1];
      fb = hm[2];
    }
    return { text: htmlToText(unesc(s)).trim(), correct: fraction >= 100, feedback: htmlToText(unesc(fb)) };
  });
}

function parseQuestion(node: XNode, type: string, lang: TextLang, category: ImportQuestion["category"], source: string): ParsedQuestion | ParseIssue {
  const warnings: string[] = [];
  const qtNode = kid(node, "questiontext");
  const html = txtOf(qtNode);
  const files = filesOf(qtNode, warnings);
  // our own export: the full bilingual question travels in <daleel>
  const ext = kid(node, "daleel");
  if (ext) {
    try {
      const q = JSON.parse(ext.text) as ImportQuestion;
      if (q && typeof q === "object" && typeof q.type === "string") return { q: { ...q, category: q.category ?? category }, source, warnings, files };
    } catch {
      warnings.push("daleel_ignored");
    }
  }
  const stemText = htmlToText(html);
  const L = pickLang(lang, stemText);
  const make = (t: QuestionType, stem = stemText) => {
    const q = blankImport(t, L, stem);
    const g = num(txtOf(kid(node, "defaultgrade")));
    if (g > 0 && g <= 9999) q.points = Math.round(g * 100) / 100;
    const fb = htmlToText(txtOf(kid(node, "generalfeedback")));
    if (fb) q[L === "ar" ? "feedbackAr" : "feedbackEn"] = fb;
    q.keywords = kids(kid(node, "tags"), "tag").map((t) => txtOf(t)).filter(Boolean).slice(0, 20);
    q.category = category;
    return q;
  };
  const answers = kids(node, "answer").map((a) => ({ text: htmlToText(txtOf(a)), fraction: num(a.attrs.fraction), feedback: htmlToText(txtOf(kid(a, "feedback"))), node: a }));
  const done = (q: ImportQuestion): ParsedQuestion => ({ q, source, warnings, files });

  switch (type) {
    case "multichoice": {
      const single = txtOf(kid(node, "single")).toLowerCase() !== "false" && txtOf(kid(node, "single")) !== "0";
      const opts = answers.map((a) => ({ ...item(a.text, L), a }));
      const q = make(single ? "MCQ" : "MULTI");
      q.content = { options: opts.map(({ id, textAr, textEn }) => ({ id, textAr, textEn })) };
      for (const o of opts) if (o.a.feedback) q.optionRationale[o.id] = { [L]: o.a.feedback };
      if (single) {
        const best = opts.reduce((m, o) => (o.a.fraction > m.a.fraction ? o : m), opts[0]);
        if (!best || !(best.a.fraction > 0)) return { source, reason: "no_correct_answer" };
        if (best.a.fraction < 100) warnings.push("partial_credit_dropped");
        if (opts.filter((o) => o.a.fraction > 0).length > 1) warnings.push("partial_credit_dropped");
        q.answer = { correct: [best.id] };
      } else {
        q.answer = { correct: opts.filter((o) => o.a.fraction > 0).map((o) => o.id) };
        q.scoring = { mode: opts.some((o) => o.a.fraction < 0) ? "PARTIAL_PENALTY" : "PARTIAL" };
      }
      return done(q);
    }
    case "truefalse": {
      const right = answers.find((a) => a.fraction >= 100);
      if (!right) return { source, reason: "no_correct_answer" };
      const q = make("TRUE_FALSE");
      q.answer = { value: /^(true|صح|صحيح)$/i.test(right.text.trim()) };
      return done(q);
    }
    case "numerical": {
      const right = answers.find((a) => a.fraction >= 100);
      if (!right || right.text.trim() === "*" || Number.isNaN(num(right.text))) return { source, reason: "no_correct_answer" };
      if (answers.length > 1) warnings.push("extra_answers_dropped");
      const q = make("NUMERIC");
      const tol = num(txtOf(kid(right.node, "tolerance")));
      q.answer = { value: num(right.text), tolerance: Number.isNaN(tol) ? 0 : Math.abs(tol) };
      const unit = txtOf(path(node, "units", "unit", "unit_name"));
      q.content = L === "ar" ? { unitAr: unit, unitEn: "" } : { unitAr: "", unitEn: unit };
      return done(q);
    }
    case "shortanswer": {
      const ok = answers.filter((a) => a.fraction >= 100).map((a) => a.text).filter(Boolean);
      if (!ok.length) return { source, reason: "no_correct_answer" };
      if (answers.some((a) => a.fraction > 0 && a.fraction < 100)) warnings.push("partial_credit_dropped");
      if (ok.some((t) => t.includes("*"))) warnings.push("wildcard_literal");
      const q = make("SHORT");
      q.answer = { accepted: ok, caseSensitive: txtOf(kid(node, "usecase")) === "1" };
      return done(q);
    }
    case "essay": {
      const q = make("ESSAY");
      const rubric = htmlToText(txtOf(kid(node, "graderinfo")));
      q.answer = L === "ar" ? { rubricAr: rubric, rubricEn: "" } : { rubricAr: "", rubricEn: rubric };
      const mn = num(txtOf(kid(node, "minwordlimit")));
      const mx = num(txtOf(kid(node, "maxwordlimit")));
      q.content = { ...(mn > 0 ? { minWords: mn } : {}), ...(mx > 0 ? { maxWords: mx } : {}) };
      return done(q);
    }
    case "matching": {
      const subs = kids(node, "subquestion").map((s) => ({ left: htmlToText(txtOf(s)), right: htmlToText(txtOf(kid(s, "answer"))) }));
      const rights: Item[] = [];
      const rightId = (t: string) => {
        let r = rights.find((x) => (x.textAr || x.textEn) === t);
        if (!r) rights.push((r = item(t, L)));
        return r.id;
      };
      const pairs = subs.filter((s) => s.left).map((s) => ({ l: item(s.left, L), r: rightId(s.right) }));
      subs.filter((s) => !s.left && s.right).forEach((s) => rightId(s.right));
      if (pairs.length < 2) return { source, reason: "too_few_items" };
      const shared = new Set(pairs.map((p) => p.r)).size < pairs.length;
      if (shared) {
        // several items share one answer → our drag & drop (zones may hold several items)
        const q = make("DRAGDROP");
        q.content = { items: pairs.map((p) => p.l), zones: rights };
        q.answer = { placements: Object.fromEntries(pairs.map((p) => [p.l.id, p.r])) };
        q.scoring = { mode: "PARTIAL" };
        warnings.push("matching_as_dragdrop");
        return done(q);
      }
      const q = make("MATCHING");
      q.content = { left: pairs.map((p) => p.l), right: rights };
      q.answer = { pairs: Object.fromEntries(pairs.map((p) => [p.l.id, p.r])) };
      q.scoring = { mode: "PARTIAL" };
      return done(q);
    }
    case "ordering": {
      const ordered = answers.map((a, i) => ({ a, i })).sort((x, y) => (Number.isNaN(x.a.fraction) || Number.isNaN(y.a.fraction) ? x.i - y.i : x.a.fraction - y.a.fraction || x.i - y.i));
      if (ordered.length < 2) return { source, reason: "too_few_items" };
      const q = make("ORDERING");
      q.content = { items: ordered.map((o) => item(o.a.text, L)) };
      q.scoring = { mode: "PARTIAL" };
      return done(q);
    }
    case "gapselect":
    case "ddwtos": {
      const choices = kids(node, type === "gapselect" ? "selectoption" : "dragbox").map((c) => ({ text: htmlToText(txtOf(c)), group: txtOf(kid(c, "group")) || "1" }));
      const blanks: NonNullable<ImportQuestion["content"]["blanks"]> = [];
      const answer: NonNullable<ImportQuestion["answer"]["blanks"]> = {};
      let k = 0;
      let bad = false;
      const text = stemText.replace(/\[\[(\d+)\]\]/g, (_m, n: string) => {
        const c = choices[Number(n) - 1];
        if (!c) {
          bad = true;
          return "";
        }
        k++;
        const id = String(k);
        const opts = choices.map((x, i) => ({ x, i })).filter(({ x }) => x.group === c.group).map(({ x, i }) => ({ ...item(x.text, L, `c${i + 1}`) }));
        blanks.push({ id, kind: "SELECT", options: opts });
        answer[id] = { correct: `c${Number(n)}` };
        return `[[${id}]]`;
      });
      if (bad || !blanks.length) return { source, reason: "bad_blanks" };
      const q = make("CLOZE", L === "ar" ? "أكمل الفراغات." : "Fill in the blanks.");
      q.content = L === "ar" ? { textAr: text, textEn: "", blanks } : { textAr: "", textEn: text, blanks };
      q.answer = { blanks: answer };
      q.scoring = { mode: "PARTIAL" };
      if (type === "ddwtos") warnings.push("drag_words_as_dropdowns");
      return done(q);
    }
    case "multianswer": {
      const blanks: NonNullable<ImportQuestion["content"]["blanks"]> = [];
      const answer: NonNullable<ImportQuestion["answer"]["blanks"]> = {};
      let unsupported = "";
      let k = 0;
      // work on the raw HTML so embedded answers keep their own text; convert the result to plain text after
      const marked = html.replace(/\{(\d*):([A-Z_]+):((?:\\.|[^}])*)\}/g, (_m, _w: string, kind: string, body: string) => {
        const list = parseClozeAnswers(body);
        k++;
        const id = String(k);
        if (/^(MULTICHOICE|MC)(_[VHS]+)?$|^MC[VHS]+$/.test(kind)) {
          const opts = list.map((a) => item(a.text, L));
          const right = list.findIndex((a) => a.correct);
          if (right < 0) unsupported ||= "no_correct_answer";
          blanks.push({ id, kind: "SELECT", options: opts });
          answer[id] = { correct: opts[Math.max(0, right)]?.id };
        } else if (/^(SHORTANSWER|SA|MW)(_C)?$|^(SAC|MWC)$/.test(kind)) {
          const ok = list.filter((a) => a.correct).map((a) => a.text);
          if (!ok.length) unsupported ||= "no_correct_answer";
          blanks.push({ id, kind: "TEXT" });
          answer[id] = { accepted: ok, caseSensitive: /_C$|^(SAC|MWC)$/.test(kind) };
        } else if (/^(NUMERICAL|NM)$/.test(kind)) {
          const right = list.find((a) => a.correct);
          const [v, tol] = (right?.text ?? "").split(":");
          if (!right || (tol && Number(tol) !== 0)) unsupported ||= `cloze_${kind}`;
          blanks.push({ id, kind: "TEXT" });
          answer[id] = { accepted: [v.trim()] };
          warnings.push("numeric_blank_as_text");
        } else unsupported ||= `cloze_${kind}`;
        return `[[${id}]]`;
      });
      if (unsupported) return { source, reason: "unsupported_part", detail: unsupported };
      if (!blanks.length) return { source, reason: "bad_blanks" };
      const text = htmlToText(marked);
      const q = make("CLOZE", L === "ar" ? "أكمل الفراغات." : "Fill in the blanks.");
      q.content = L === "ar" ? { textAr: text, textEn: "", blanks } : { textAr: "", textEn: text, blanks };
      q.answer = { blanks: answer };
      q.scoring = { mode: "PARTIAL" };
      return done(q);
    }
  }
  return { source, reason: "unsupported_type", detail: type };
}

export function parseMoodle(xml: string, lang: TextLang = "auto"): ParseResult {
  const out: ParseResult = { questions: [], issues: [] };
  let root: XNode;
  try {
    root = parseXml(xml);
  } catch (e) {
    return { questions: [], issues: [{ source: "file", reason: "bad_xml", detail: (e as Error).message }] };
  }
  const quiz = kid(root, "quiz");
  if (!quiz) return { questions: [], issues: [{ source: "file", reason: "not_moodle" }] };
  let category: ImportQuestion["category"];
  let n = 0;
  for (const node of kids(quiz, "question")) {
    const type = node.attrs.type ?? "";
    if (type === "category") {
      category = categoryFromPath(txtOf(kid(node, "category")));
      continue;
    }
    if (type === "description") continue;
    n++;
    const name = txtOf(kid(node, "name"));
    const source = `#${n}${name ? ` · ${name.slice(0, 60)}` : ""}`;
    const r = parseQuestion(node, type, lang, category, source);
    if ("q" in r) out.questions.push(r);
    else out.issues.push(r);
  }
  return out;
}

/* ───────────── export ───────────── */

const frac = (v: number) => String(Math.round(v * 100000) / 100000);
/** escape the characters that mean something inside a Moodle Cloze answer */
const clozeEsc = (s: string) => s.replace(/[\\}#~/"]/g, (c) => `\\${c}`);
const catPath = (c: ImportQuestion["category"]) => ["$course$", "top", c?.domain, c?.topic, c?.subtopic].filter(Boolean).join("/");

function figureHtml(q: ExportQuestion, lang: "ar" | "en") {
  const f = q.content.figure;
  if (!f) return "";
  const cap = inLang(f.captionAr, f.captionEn, lang);
  const rows = f.rows.map((r, i) => `<tr>${r.map((c) => (i === 0 ? `<th>${escHtml(c)}</th>` : `<td>${escHtml(c)}</td>`)).join("")}</tr>`).join("");
  return `<table border="1">${cap ? `<caption>${escHtml(cap)}</caption>` : ""}${rows}</table>`;
}

export function exportMoodle(qs: ExportQuestion[], lang: "ar" | "en", files: Record<string, string> = {}): ExportResult {
  const skipped: ExportResult["skipped"] = [];
  const parts: string[] = [];
  let lastCat = "";
  let exported = 0;
  const T = (ar?: string, en?: string) => inLang(ar, en, lang);
  const textEl = (tag: string, text: string, html = true, extra = "") => `<${tag} format="${html ? "html" : "plain_text"}"><text>${cdata(html ? textToHtml(text) : text)}</text>${extra}</${tag}>`;

  for (const q of qs) {
    if (q.type === "HOTSPOT") {
      skipped.push({ id: q.id, type: q.type, reason: "type_not_supported" });
      continue;
    }
    if (q.type === "DRAGDROP" && (q.content.items ?? []).some((i) => !q.answer.placements?.[i.id])) {
      skipped.push({ id: q.id, type: q.type, reason: "dragdrop_distractors" });
      continue;
    }
    const cp = catPath(q.category);
    if (cp !== lastCat) {
      parts.push(`  <question type="category"><category><text>${escXml(cp)}</text></category></question>`);
      lastCat = cp;
    }
    // question text: stem + figure as a table + attachments as files
    const imgs = q.attachments.filter((a) => files[a.path]);
    const names = imgs.map((a, i) => `${i + 1}-${(a.fileName || "file").replace(/[^A-Za-z0-9._-]/g, "_")}`);
    let qhtml = textToHtml(T(q.stemAr, q.stemEn)) + figureHtml(q, lang);
    imgs.forEach((a, i) => {
      qhtml += a.kind === "IMAGE" ? `<p><img src="@@PLUGINFILE@@/${encodeURIComponent(names[i])}" alt="${escHtml(T(a.captionAr, a.captionEn))}"></p>` : `<p><a href="@@PLUGINFILE@@/${encodeURIComponent(names[i])}">${escHtml(T(a.captionAr, a.captionEn) || names[i])}</a></p>`;
    });
    const fileEls = imgs.map((a, i) => `<file name="${escXml(names[i])}" path="/" encoding="base64">${files[a.path]}</file>`).join("");
    if (q.type === "CLOZE") {
      // the passage goes into the question text for Moodle's "Cloze" (multianswer) type
      const text = T(q.content.textAr, q.content.textEn).replace(/\[\[([^\]]+)\]\]/g, (_m, id: string) => {
        const b = (q.content.blanks ?? []).find((x) => x.id === id);
        const a = q.answer.blanks?.[id];
        if (!b || !a) return "";
        if (b.kind === "SELECT") return `{1:MULTICHOICE:${(b.options ?? []).map((o) => `${o.id === a.correct ? "=" : ""}${clozeEsc(T(o.textAr, o.textEn))}`).join("~")}}`;
        return `{1:${a.caseSensitive ? "SHORTANSWER_C" : "SHORTANSWER"}:${(a.accepted ?? []).filter((x) => x.trim()).map((x) => `=${clozeEsc(x.trim())}`).join("~")}}`;
      });
      qhtml = textToHtml(T(q.stemAr, q.stemEn)) + textToHtml(text) + figureHtml(q, lang);
    }
    const mtype: Record<QuestionType, string> = { MCQ: "multichoice", MULTI: "multichoice", TRUE_FALSE: "truefalse", NUMERIC: "numerical", SHORT: "shortanswer", ESSAY: "essay", MATCHING: "matching", ORDERING: "ordering", CLOZE: "multianswer", DRAGDROP: "matching", HOTSPOT: "" };
    const ext = { ...q } as Partial<ExportQuestion>;
    delete ext.id;
    delete ext.attachments;
    delete ext.status;
    delete ext.version;
    const body: string[] = [
      `<name><text>${escXml(T(q.stemAr, q.stemEn).replace(/\s+/g, " ").slice(0, 60) || q.type)}</text></name>`,
      `<questiontext format="html"><text>${cdata(qhtml)}</text>${fileEls}</questiontext>`,
      textEl("generalfeedback", T(q.feedbackAr, q.feedbackEn)),
      `<defaultgrade>${q.points}</defaultgrade>`,
      `<penalty>0</penalty>`,
      `<hidden>0</hidden>`,
    ];
    const ans = (fraction: number, text: string, fb = "", extra = "") => `<answer fraction="${frac(fraction)}" format="html"><text>${cdata(textToHtml(text))}</text>${fb ? textEl("feedback", fb) : ""}${extra}</answer>`;
    const plainAns = (fraction: number, text: string, extra = "") => `<answer fraction="${frac(fraction)}" format="plain_text"><text>${escXml(text)}</text>${extra}</answer>`;
    switch (q.type) {
      case "MCQ":
      case "MULTI": {
        const correct = q.answer.correct ?? [];
        const n = Math.max(1, correct.length);
        body.push(`<single>${q.type === "MCQ"}</single>`, `<shuffleanswers>true</shuffleanswers>`, `<answernumbering>abc</answernumbering>`);
        for (const o of q.content.options ?? []) {
          const ok = correct.includes(o.id);
          const f = q.type === "MCQ" ? (ok ? 100 : 0) : ok ? 100 / n : q.scoring.mode === "PARTIAL_PENALTY" ? -100 / n : 0;
          const r = q.optionRationale[o.id];
          body.push(ans(f, T(o.textAr, o.textEn), inLang(r?.ar, r?.en, lang)));
        }
        break;
      }
      case "TRUE_FALSE":
        body.push(plainAns(q.answer.value === true ? 100 : 0, "true"), plainAns(q.answer.value === false ? 100 : 0, "false"));
        break;
      case "NUMERIC": {
        body.push(plainAns(100, String(q.answer.value ?? 0), `<tolerance>${q.answer.tolerance ?? 0}</tolerance>`));
        const unit = T(q.content.unitAr, q.content.unitEn);
        if (unit) body.push(`<units><unit><multiplier>1</multiplier><unit_name>${escXml(unit)}</unit_name></unit></units>`, `<unitgradingtype>0</unitgradingtype>`, `<showunits>3</showunits>`, `<unitsleft>0</unitsleft>`);
        break;
      }
      case "SHORT":
        body.push(`<usecase>${q.answer.caseSensitive ? 1 : 0}</usecase>`, ...(q.answer.accepted ?? []).filter((x) => x.trim()).map((x) => plainAns(100, x.trim())));
        break;
      case "ESSAY":
        body.push(
          `<responseformat>editor</responseformat>`,
          `<responserequired>1</responserequired>`,
          `<responsefieldlines>15</responsefieldlines>`,
          ...(q.content.minWords ? [`<minwordlimit>${q.content.minWords}</minwordlimit>`] : []),
          ...(q.content.maxWords ? [`<maxwordlimit>${q.content.maxWords}</maxwordlimit>`] : []),
          textEl("graderinfo", T(q.answer.rubricAr, q.answer.rubricEn)),
        );
        break;
      case "MATCHING": {
        body.push(`<shuffleanswers>true</shuffleanswers>`);
        const used = new Set<string>();
        for (const l of q.content.left ?? []) {
          const r = (q.content.right ?? []).find((x) => x.id === q.answer.pairs?.[l.id]);
          if (r) used.add(r.id);
          body.push(`<subquestion format="html"><text>${cdata(textToHtml(T(l.textAr, l.textEn)))}</text><answer><text>${escXml(r ? T(r.textAr, r.textEn) : "")}</text></answer></subquestion>`);
        }
        for (const r of (q.content.right ?? []).filter((x) => !used.has(x.id))) body.push(`<subquestion format="html"><text></text><answer><text>${escXml(T(r.textAr, r.textEn))}</text></answer></subquestion>`);
        break;
      }
      case "DRAGDROP": {
        body.push(`<shuffleanswers>true</shuffleanswers>`);
        for (const it of q.content.items ?? []) {
          const z = (q.content.zones ?? []).find((x) => x.id === q.answer.placements?.[it.id]);
          body.push(`<subquestion format="html"><text>${cdata(textToHtml(T(it.textAr, it.textEn)))}</text><answer><text>${escXml(z ? T(z.textAr, z.textEn) : "")}</text></answer></subquestion>`);
        }
        break;
      }
      case "ORDERING":
        body.push(`<layouttype>VERTICAL</layouttype>`, `<selecttype>ALL</selecttype>`, `<selectcount>0</selectcount>`, `<gradingtype>${q.scoring.mode === "PARTIAL" ? "ABSOLUTE_POSITION" : "ALL_OR_NOTHING"}</gradingtype>`);
        (q.content.items ?? []).forEach((it, i) => body.push(ans(i + 1, T(it.textAr, it.textEn))));
        break;
      case "CLOZE":
        break;
    }
    if (q.keywords.length) body.push(`<tags>${q.keywords.map((k) => `<tag><text>${escXml(k)}</text></tag>`).join("")}</tags>`);
    body.push(`<daleel>${cdata(JSON.stringify(ext))}</daleel>`);
    parts.push(`  <question type="${mtype[q.type]}">\n    ${body.join("\n    ")}\n  </question>`);
    exported++;
  }
  return { text: `<?xml version="1.0" encoding="UTF-8"?>\n<quiz>\n${parts.join("\n")}\n</quiz>\n`, mime: "application/xml", ext: "xml", exported, skipped };
}

