/**
 * Question bank → a page laid out for printing. The browser turns it into the PDF ("Save as PDF"), which keeps
 * Arabic shaping right and leaves real text that the PDF import reads back (see pdf-questions.ts for the labels).
 */
import { PDF_TYPES } from "./pdf-questions";
import { inLang, mimeOf, type ExportQuestion, type ExportResult } from "./types";

export type PdfAnswers = "inline" | "end" | "none";

const WORDS = {
  ar: {
    title: "بنك الأسئلة", count: "عدد الأسئلة", question: "السؤال", type: "نوع السؤال", answer: "الإجابة الصحيحة", model: "نموذج الإجابة",
    explanation: "الشرح", feedback: "التغذية الراجعة", note: "تعليل الخيار", difficulty: "الصعوبة", points: "الدرجة", domain: "المجال", topic: "الموضوع",
    subtopic: "الموضوع الفرعي", reference: "المرجع", keywords: "الكلمات المفتاحية", key: "مفتاح الإجابات", caseStart: "دراسة الحالة", caseEnd: "نهاية دراسة الحالة", end: "نهاية ملف الأسئلة",
    yes: "صح", no: "خطأ", sep: "، ",
    letters: ["أ", "ب", "ج", "د", "هـ", "و", "ز", "ح"],
    levels: { EASY: "سهل", MEDIUM: "متوسط", HARD: "صعب" },
    types: { MULTI: "متعدد الإجابات", TRUE_FALSE: "صح أو خطأ", NUMERIC: "رقمي", SHORT: "إجابة قصيرة", ESSAY: "مقالي", ORDERING: "ترتيب" },
  },
  en: {
    title: "Question bank", count: "Number of questions", question: "Question", type: "Question type", answer: "Correct answer", model: "Model answer",
    explanation: "Explanation", feedback: "Feedback", note: "Option note", difficulty: "Difficulty", points: "Points", domain: "Domain", topic: "Topic",
    subtopic: "Subtopic", reference: "Reference", keywords: "Keywords", key: "Answer key", caseStart: "Case study", caseEnd: "End of case study", end: "End of question file",
    yes: "True", no: "False", sep: ", ",
    letters: ["A", "B", "C", "D", "E", "F", "G", "H"],
    levels: { EASY: "Easy", MEDIUM: "Medium", HARD: "Hard" },
    types: { MULTI: "Multiple response", TRUE_FALSE: "True or false", NUMERIC: "Numeric", SHORT: "Short answer", ESSAY: "Essay", ORDERING: "Ordering" },
  },
} as const;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const lines = (s: string) => s.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

export function exportPdf(qs: ExportQuestion[], chosen: "ar" | "en", files: Record<string, string> = {}, course?: { code?: string | null; title?: string }, answers: PdfAnswers = "inline"): ExportResult {
  // when most questions have no text in the chosen language, the page is written in the language they do have:
  // Arabic text on a left-to-right English page (or the reverse) neither reads nor imports correctly
  const written = qs.filter((q) => (chosen === "ar" ? q.stemAr : q.stemEn)?.trim()).length;
  const lang: "ar" | "en" = written * 2 >= qs.length ? chosen : chosen === "ar" ? "en" : "ar";
  const w = WORDS[lang];
  const skipped: ExportResult["skipped"] = [];
  const body: string[] = [];
  const key: string[] = [];

  const text = (s: string, cls = "") => lines(s).map((l) => `<p class="${cls}" dir="auto">${esc(l)}</p>`).join("");
  /** "label: text", further paragraphs underneath */
  const field = (label: string, value: string, cls = "f") => {
    const [first, ...rest] = lines(value);
    return first ? `<p class="${cls}"><b>${label}:</b> <bdi>${esc(first)}</bdi></p>${text(rest.join("\n"), cls)}` : "";
  };

  let n = 0;
  let openCase = "";
  for (const q of qs) {
    if (!PDF_TYPES.includes(q.type)) {
      skipped.push({ id: q.id, type: q.type, reason: "type_not_supported" });
      continue;
    }
    let items = (q.type === "ORDERING" ? q.content.items : q.type === "MCQ" || q.type === "MULTI" ? q.content.options : []) ?? [];
    if (items.length > w.letters.length) {
      skipped.push({ id: q.id, type: q.type, reason: "too_many_options" });
      continue;
    }
    n++;
    const caseKey = q.scenario ? q.scenario.key || q.scenario.titleAr || q.scenario.titleEn : "";
    if (openCase && openCase !== caseKey) body.push(`<p class="case-end">${w.caseEnd}</p>`);
    if (q.scenario && openCase !== caseKey) {
      body.push(`<section class="case">${field(w.caseStart, inLang(q.scenario.titleAr, q.scenario.titleEn, lang) || caseKey)}${text(inLang(q.scenario.bodyAr, q.scenario.bodyEn, lang))}</section>`);
    }
    openCase = caseKey;

    // an ordering question whose answers are not next to it must not show the right order
    const order = q.type === "ORDERING" ? q.answer.order ?? items.map((i) => i.id) : [];
    if (q.type === "ORDERING") {
      const right = order.map((id) => items.find((i) => i.id === id)!).filter(Boolean);
      items = answers === "inline" ? right : [...right.filter((_, i) => i % 2 === 1), ...right.filter((_, i) => i % 2 === 0)];
    }
    const letterOf = (id: string) => w.letters[items.findIndex((i) => i.id === id)] ?? "?";

    const parts = [`<h2>${w.question} ${n}:</h2>`];
    if (q.type !== "MCQ") parts.push(`<p class="meta">${w.type}: ${w.types[q.type as keyof typeof w.types]}</p>`);
    parts.push(text(inLang(q.stemAr, q.stemEn, lang), "stem"));
    const fig = q.content.figure;
    if (fig?.rows?.length) parts.push(`<table>${fig.rows.map((r) => `<tr>${r.map((c) => `<td dir="auto">${esc(String(c))}</td>`).join("")}</tr>`).join("")}</table>`);
    for (const a of q.attachments ?? []) {
      const mime = a.mime || mimeOf(a.fileName);
      if (a.kind === "IMAGE" && files[a.path] && /^image\/(png|jpeg|webp|gif)$/.test(mime)) parts.push(`<img alt="" src="data:${mime};base64,${files[a.path].replace(/[^A-Za-z0-9+/=]/g, "")}">`);
    }
    items.forEach((o, i) => parts.push(`<p class="opt"><b>${w.letters[i]})</b> <bdi>${esc(lines(inLang(o.textAr, o.textEn, lang)).join(" "))}</bdi></p>`));

    const solution: string[] = [];
    if (answers !== "none") {
      let value = "";
      if (q.type === "MCQ" || q.type === "MULTI") value = (q.answer.correct ?? []).map(letterOf).sort((a, b) => w.letters.indexOf(a as never) - w.letters.indexOf(b as never)).join(w.sep);
      if (q.type === "ORDERING") value = order.map(letterOf).join(w.sep);
      if (q.type === "TRUE_FALSE") value = q.answer.value ? w.yes : w.no;
      if (q.type === "NUMERIC") value = `${q.answer.value ?? ""}${q.answer.tolerance ? ` ± ${q.answer.tolerance}` : ""}`;
      if (q.type === "SHORT") value = (q.answer.accepted ?? []).join(" | ");
      solution.push(q.type === "ESSAY" ? field(w.model, inLang(q.answer.rubricAr, q.answer.rubricEn, lang), "ans") : field(w.answer, value, "ans"));
      solution.push(field(w.explanation, inLang(q.explanationAr, q.explanationEn, lang)));
      solution.push(field(w.feedback, inLang(q.feedbackAr, q.feedbackEn, lang)));
      items.forEach((o, i) => {
        const r = q.optionRationale?.[o.id];
        if (r) solution.push(field(`${w.note} ${w.letters[i]}`, inLang(r.ar, r.en, lang)));
      });
      solution.push(field(w.difficulty, w.levels[q.difficulty], "meta"), field(w.points, String(q.points), "meta"));
      solution.push(field(w.domain, q.category?.domain ?? "", "meta"), field(w.topic, q.category?.topic ?? "", "meta"), field(w.subtopic, q.category?.subtopic ?? "", "meta"));
      solution.push(field(w.reference, q.reference ?? "", "meta"), field(w.keywords, (q.keywords ?? []).join(w.sep), "meta"));
    }
    if (answers === "end") key.push(`<section class="q"><h2>${w.question} ${n}:</h2>${solution.join("")}</section>`);
    else parts.push(...solution);
    body.push(`<section class="q">${parts.join("")}</section>`);
  }
  if (openCase) body.push(`<p class="case-end">${w.caseEnd}</p>`);
  if (key.length) body.push(`<h1 class="key">${w.key}</h1>`, ...key);

  const name = [course?.code, course?.title].filter(Boolean).join(" — ");
  const html = `<!doctype html>
<html lang="${lang}" dir="${lang === "ar" ? "rtl" : "ltr"}"><head><meta charset="utf-8">
<title>${esc(`${course?.code || "bank"}-questions`)}</title>
<style>
@page { size: A4; margin: 15mm 14mm; }
body { font-family: "Segoe UI", Arial, Tahoma, sans-serif; font-size: 12pt; line-height: 1.75; color: #111; margin: 0; font-variant-ligatures: none; }
h1 { font-size: 16pt; margin: 0 0 4pt; }
h1.key { break-before: page; }
h2 { font-size: 12.5pt; margin: 0 0 2pt; color: #0b2545; }
p { margin: 1pt 0; }
.q { margin: 0 0 20pt; }
.q h2, .q .stem, .q .opt { break-after: avoid; }
.opt { margin-inline-start: 14pt; }
.ans { margin-top: 4pt; color: #065f46; }
.meta { font-size: 10pt; color: #555; }
.case { border-inline-start: 3pt solid #c9a227; padding-inline-start: 8pt; margin: 0 0 12pt; }
.case-end { font-size: 10pt; color: #555; margin: 0 0 20pt; }
table { border-collapse: collapse; margin: 6pt 0; }
td { border: .5pt solid #999; padding: 2pt 8pt; }
img { display: block; max-width: 100%; max-height: 90mm; margin: 6pt 0; }
.intro { margin-bottom: 20pt; }
.end { text-align: center; color: #777; font-size: 10pt; }
</style></head><body>
<header class="intro"><h1>${w.title}${name ? ` — <bdi>${esc(name)}</bdi>` : ""}</h1><p class="meta">${w.count}: ${n}</p></header>
${body.join("\n")}
<p class="end">— ${w.end} —</p>
</body></html>`;
  return { text: html, mime: "text/html", ext: "pdf", exported: n, skipped };
}
