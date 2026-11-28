// PDF question import / export (no database). run: npx tsx scripts/test-exams-pdf.ts
// The round trip needs Chrome or Edge to turn the exported page into a real PDF; without one it is skipped.
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { exportAs, parseFile, type ExportQuestion } from "../src/lib/exams/io";
import { parseQuestionLines } from "../src/lib/exams/io/pdf-questions";
import { applyFixes, ligatureFixes } from "../src/lib/exams/io/pdf-text";

const results: { name: string; pass: boolean; info: string }[] = [];
const ok = (name: string, pass: unknown, info = "") => results.push({ name, pass: !!pass, info });
const L = (s: string) => s.split("\n");
const right = (q: { content: { options?: { textAr: string; textEn: string }[] }; answer: { correct?: string[] } }) =>
  (q.content.options as { id?: string; textAr: string; textEn: string }[]).map((o, i) => (q.answer.correct?.includes(o.id!) ? i : -1)).filter((i) => i >= 0).join();

function parserTests() {
  let r = parseQuestionLines(L(`بنك الأسئلة التجريبي
السؤال 1:
ما المخرج الرئيسي لعملية تطوير
ميثاق المشروع؟
أ) خطة إدارة المشروع
ب) ميثاق المشروع
ج) سجل المخاطر
الإجابة الصحيحة: ب
الشرح: الميثاق يخوّل المشروع رسميًا.
1. أولًا
2. ثانيًا
التغذية الراجعة: راجع مجموعة البدء.
تعليل الخيار أ: الخطة تأتي لاحقًا.
الصعوبة: سهل
الدرجة: 2
المجال: البدء
المرجع: PMBOK 7`));
  let q = r.questions[0]?.q;
  ok("Arabic: wrapped question text, three options and the right one", r.questions.length === 1 && q.type === "MCQ" && q.stemAr === "ما المخرج الرئيسي لعملية تطوير ميثاق المشروع؟" && q.content.options?.length === 3 && right(q) === "1", JSON.stringify(r));
  ok("Arabic: explanation (with its numbered list), feedback and option note each in its own field", q.explanationAr === "الميثاق يخوّل المشروع رسميًا. 1. أولًا 2. ثانيًا" && q.feedbackAr === "راجع مجموعة البدء." && Object.values(q.optionRationale)[0]?.ar === "الخطة تأتي لاحقًا.", JSON.stringify([q.explanationAr, q.feedbackAr, q.optionRationale]));
  ok("Arabic: difficulty, points, category and reference", q.difficulty === "EASY" && q.points === 2 && q.category?.domain === "البدء" && q.reference === "PMBOK 7");

  r = parseQuestionLines(L(`1. What does WBS stand for?
A) Work Breakdown Structure
B) Work Budget Schedule
Answer: A
2) Select two planning processes.
A. Define scope   B. Close project   C. Create WBS
Correct answers: A, C
Feedback: Both belong to planning.
3- The risk register is created in Identify Risks.
Answer: True
4. SPI when EV = 80 and PV = 100?
Answer: 0.8 ± 0.01
5. Name the document that authorizes a project.
Answer: Project charter | Charter
6. Explain the difference between a risk and an issue.
Question type: Essay`));
  ok("English numbered file: six types read", r.questions.map((p) => p.q.type).join() === "MCQ,MULTI,TRUE_FALSE,NUMERIC,SHORT,ESSAY" && !r.issues.length, r.questions.map((p) => p.q.type).join() + JSON.stringify(r.issues));
  ok("Options on one line are separated; two right answers kept", r.questions[1]?.q.content.options?.length === 3 && right(r.questions[1].q) === "0,2" && r.questions[1].q.feedbackEn === "Both belong to planning.");
  ok("Numeric tolerance, short answers", r.questions[3]?.q.answer.tolerance === 0.01 && r.questions[4]?.q.answer.accepted?.length === 2);

  r = parseQuestionLines(L(`السؤال 1:
عاصمة ليبيا؟
أ) طرابلس
ب) بنغازي
السؤال 2:
اختر لونين من العلم.
أ) أحمر
ب) أزرق
ج) أخضر
مفتاح الإجابات
السؤال 1: أ
الشرح: هي العاصمة.
1. نقطة
2. نقطة أخرى
السؤال 2: أ، ج
التغذية الراجعة: أحسنت.`));
  ok("Key at the end: each answer, explanation and feedback reach their question", r.questions.length === 2 && !r.issues.length && right(r.questions[0].q) === "0" && r.questions[0].q.explanationAr.startsWith("هي العاصمة") && right(r.questions[1].q) === "0,2" && r.questions[1].q.feedbackAr === "أحسنت." && !r.questions[0].q.feedbackAr, JSON.stringify(r));

  r = parseQuestionLines(L(`1. First?
A) x
B) y
2. Second?
A) x
B) y
3. Third?
A) x
B) y
Answer Key
1. B 2. A 3. B`));
  ok("Compact key, several answers on one line", r.questions.length === 3 && r.questions.map((p) => right(p.q)).join("|") === "1|0|1" && !r.issues.length, JSON.stringify(r.issues));

  r = parseQuestionLines(L(`Which is a tree?
A) Oak *
B) Stone

Which is a fish?
A) Cat
B) Tuna
Answer: B`));
  ok("Unnumbered questions and a * mark", r.questions.length === 2 && right(r.questions[0].q) === "0" && right(r.questions[1].q) === "1", JSON.stringify(r));

  r = parseQuestionLines(L(`1. No answer here?
A) x
B) y
2. Wrong letter?
A) x
B) y
Answer: D
3. Only one option?
A) x
Answer: A`));
  ok("Nothing is guessed: missing, unmatched and incomplete answers are reported", !r.questions.length && r.issues.map((x) => `${x.source}:${x.reason}`).join() === "Q1:no_correct_answer,Q2:answer_not_matched,Q3:options_missing", JSON.stringify(r.issues));

  r = parseQuestionLines(L(`دراسة الحالة: مشروع الجسر
تأخر المورد أسبوعين.
السؤال 1:
ما الإجراء؟
أ) تحليل الأثر
ب) إلغاء المشروع
الإجابة: أ
نهاية دراسة الحالة
السؤال 2:
سؤال مستقل.
الإجابة: صح`));
  ok("Case study attaches to its questions only", r.questions[0]?.q.scenario?.bodyAr === "تأخر المورد أسبوعين." && !r.questions[1]?.q.scenario && r.questions[1]?.q.type === "TRUE_FALSE", JSON.stringify(r));
  ok("A text with no questions says so", parseQuestionLines(["مجرد نص"]).issues[0]?.reason === "no_questions_found");
}

const BROWSERS = ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "/usr/bin/google-chrome", "/usr/bin/chromium"];

async function roundTrip() {
  const base = { status: "ACTIVE", version: 1, attachments: [], content: {}, answer: {}, scoring: { mode: "ALL_OR_NOTHING" as const }, weight: 1, keywords: [], reference: "", feedbackAr: "", feedbackEn: "", explanationAr: "", explanationEn: "", optionRationale: {}, stemEn: "", points: 1, difficulty: "MEDIUM" as const };
  const opt = (...t: string[]) => t.map((x, i) => ({ id: `o${i}`, textAr: x, textEn: "" }));
  const qs: ExportQuestion[] = [
    { ...base, id: "1", type: "MCQ", stemAr: "ما المخرج الرئيسي لعملية تطوير ميثاق المشروع في إدارة المشاريع الاحترافية؟ هذا سؤال طويل يلتف على أكثر من سطر ليختبر دمج الأسطر.", content: { options: opt("خطة المشروع", "ميثاق المشروع (Project Charter)", "لوحة كانبان - Kanban board", "A") }, answer: { correct: ["o1"] }, explanationAr: "الميثاق يخول المشروع رسميا.", feedbackAr: "راجع مجموعة البدء.", reference: "PMBOK 7", category: { domain: "البدء" } },
    { ...base, id: "2", type: "MULTI", stemAr: "اختر عمليتين من مجموعة التخطيط.", content: { options: opt("تحديد النطاق", "إغلاق المشروع", "إنشاء هيكل تجزئة العمل") }, answer: { correct: ["o0", "o2"] }, scoring: { mode: "PARTIAL" }, points: 2, difficulty: "HARD" },
    { ...base, id: "3", type: "TRUE_FALSE", stemAr: "سجل المخاطر من مخرجات تحديد المخاطر.", answer: { value: true } },
    { ...base, id: "4", type: "NUMERIC", stemAr: "ما مؤشر أداء الجدول إذا كانت القيمة المكتسبة 80 والمخططة 100؟", answer: { value: 0.8, tolerance: 0.01 } },
    { ...base, id: "5", type: "SHORT", stemAr: "ما اختصار هيكل تجزئة العمل بالإنجليزية؟", answer: { accepted: ["WBS"] } },
    { ...base, id: "6", type: "ESSAY", stemAr: "اشرح الفرق بين المخاطر والقضايا.", answer: { rubricAr: "المخاطر محتملة والقضايا وقعت." }, scoring: { mode: "MANUAL" }, points: 4 },
    { ...base, id: "7", type: "ORDERING", stemAr: "رتب مجموعات العمليات.", content: { items: opt("البدء", "التخطيط", "التنفيذ", "الإغلاق") }, answer: { order: ["o0", "o1", "o2", "o3"] }, scoring: { mode: "PARTIAL" } },
    { ...base, id: "8", type: "HOTSPOT", stemAr: "حدد المنطقة." },
  ];
  const out = exportAs("pdf", qs, "ar", {}, { code: "TEST" }, "inline");
  ok("Export: simple types and ordering are written, others are reported", out.exported === 7 && out.skipped.length === 1 && out.skipped[0].type === "HOTSPOT");
  ok("Export: a learner copy holds no answers", !/الإجابة الصحيحة|الشرح:|التغذية الراجعة/.test(exportAs("pdf", qs, "ar", {}, {}, "none").text));
  const text = exportAs("pdf", [{ ...qs[0], stemAr: '<img src=x onerror="alert(1)">' }], "ar", {}).text;
  ok("Export: question text cannot add markup to the page", !text.includes("<img src=x") && text.includes("&lt;img"));

  const browser = BROWSERS.find((b) => existsSync(b));
  if (!browser) return console.log("(round trip skipped: no Chrome or Edge found)");
  const dir = mkdtempSync(path.join(tmpdir(), "daw-pdf-"));
  try {
    for (const mode of ["inline", "end"] as const) {
      const html = path.join(dir, `${mode}.html`);
      const pdf = path.join(dir, `${mode}.pdf`);
      writeFileSync(html, exportAs("pdf", qs, "ar", {}, { code: "TEST" }, mode).text);
      execFileSync(browser, ["--headless=new", "--disable-gpu", "--no-pdf-header-footer", `--user-data-dir=${path.join(dir, "profile")}`, `--print-to-pdf=${pdf}`, pathToFileURL(html).href], { stdio: "ignore", timeout: 120_000 });
      const b = readFileSync(pdf);
      const r = await parseFile("pdf", { buffer: b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer }, "auto");
      const got = r.questions.map((p) => p.q);
      const clean = (s: string) => s.replace(/[ً-ٟ]/g, "").replace(/\s+/g, " ").trim();
      ok(`PDF (${mode}) → all 7 questions, same types, no problems`, got.map((q) => q.type).join() === "MCQ,MULTI,TRUE_FALSE,NUMERIC,SHORT,ESSAY,ORDERING" && !r.issues.length, got.map((q) => q.type).join() + JSON.stringify(r.issues) + (r.text ?? ""));
      if (got.length !== 7) continue;
      ok(`PDF (${mode}) → question texts and options match`, got.every((q, i) => clean(q.stemAr) === clean(qs[i].stemAr)) && got[0].content.options!.map((o) => clean(o.textAr || o.textEn)).join("|") === qs[0].content.options!.map((o) => clean(o.textAr)).join("|"), JSON.stringify([got.map((q) => q.stemAr), got[0].content.options]));
      ok(`PDF (${mode}) → answer keys match`, right(got[0]) === "1" && right(got[1]) === "0,2" && got[2].answer.value === true && got[3].answer.value === 0.8 && got[3].answer.tolerance === 0.01 && got[4].answer.accepted?.[0] === "WBS" && got[6].content.items!.map((o) => clean(o.textAr)).join() === "البدء,التخطيط,التنفيذ,الإغلاق", JSON.stringify(got.map((q) => q.answer)));
      ok(`PDF (${mode}) → explanation, feedback, rubric, points, difficulty, category, reference`, clean(got[0].explanationAr) === clean(qs[0].explanationAr) && clean(got[0].feedbackAr) === clean(qs[0].feedbackAr) && clean(got[5].answer.rubricAr ?? "") === clean(qs[5].answer.rubricAr!) && got[1].points === 2 && got[1].difficulty === "HARD" && got[0].category?.domain === "البدء" && got[0].reference === "PMBOK 7", JSON.stringify([got[0].explanationAr, got[0].feedbackAr, got[0].reference, got[5].answer]));
    }
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
  }
  const bad = await parseFile("pdf", { buffer: new TextEncoder().encode("not a pdf").buffer as ArrayBuffer }, "auto");
  ok("A file that is not a PDF → one clear reason", bad.issues[0]?.reason === "not_pdf", JSON.stringify(bad.issues));
}

/** words from files that keep "لا" as one glyph (Word): glyphs arrive in drawing order, right to left reversed */
function ligatureTests() {
  const fixes = ligatureFixes([["ة", "ي", "ح", "لا", "ص", "ل", "ا"], ["؟", "ق", "لا", "غ", "إ"], ["ل", "ا", "ؤ", "س", "ل", "ا"]]);
  const got = applyFixes(["الصالحية إغالق؟ السؤال"], fixes)[0];
  ok("Arabic ligature letters are put back in order, other words untouched", got === "الصلاحية إغلاق؟ السؤال", got);
}

async function main() {
  ligatureTests();
  parserTests();
  await roundTrip();
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => {
    let fail = 0;
    for (const t of results) {
      if (!t.pass) fail++;
      console.log(`${t.pass ? "PASS" : "FAIL"}  ${t.name}${t.pass ? "" : `  →  ${t.info}`}`);
    }
    console.log(`\n${results.length - fail}/${results.length} passed`);
    if (fail) process.exitCode = 1;
  });
