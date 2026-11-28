/** Phase 11 — one entry point for reading and writing question files. */
import { exportAiken, exportGift, parseAiken, parseGift } from "./gift";
import { exportMoodle, parseMoodle } from "./moodle";
import { exportPdf, type PdfAnswers } from "./pdf-export";
import { parseQuestionLines } from "./pdf-questions";
import { readPdfLines } from "./pdf-text";
import { csvTemplate, exportCsv, exportJson, JSON_FORMAT, parseCsvRows, parseJsonQuestions, readXlsx, rowsToQuestions } from "./tabular";
import type { ExportFormat, ExportQuestion, ExportResult, ImportFormat, ParseResult, TextLang } from "./types";

export * from "./types";
export type { PdfAnswers } from "./pdf-export";

export const MAX_IMPORT_BYTES = 15 * 1024 * 1024;

/** guess the format from the file name (and a peek at the text) */
export function detectFormat(name: string, head = ""): ImportFormat {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "xlsx") return "xlsx";
  if (ext === "pdf" || head.startsWith("%PDF-")) return "pdf";
  if (ext === "csv" || ext === "tsv") return "csv";
  if (ext === "json") return "json";
  if (ext === "xml") return "moodle";
  if (ext === "gift") return "gift";
  const h = head.trimStart();
  if (h.startsWith("<")) return "moodle";
  if (h.startsWith("{") || h.startsWith("[")) return "json";
  if (/^ANSWER\s*:/im.test(head) && !/[{}]/.test(head)) return "aiken";
  return "gift";
}

export async function parseFile(format: ImportFormat, data: { text?: string; buffer?: ArrayBuffer }, lang: TextLang): Promise<ParseResult> {
  switch (format) {
    case "moodle":
      return parseMoodle(data.text ?? "", lang);
    case "gift":
      return parseGift(data.text ?? "", lang);
    case "aiken":
      return parseAiken(data.text ?? "", lang);
    case "json":
      return parseJsonQuestions(data.text ?? "");
    case "csv":
      return rowsToQuestions(parseCsvRows(data.text ?? ""), lang);
    case "xlsx":
      try {
        return rowsToQuestions(await readXlsx(data.buffer ?? new ArrayBuffer(0)), lang);
      } catch (e) {
        return { questions: [], issues: [{ source: "file", reason: (e as Error).message === "file_too_large" ? "file_too_large" : "not_xlsx" }] };
      }
    case "pdf":
      try {
        const read = await readPdfLines(data.buffer ?? new ArrayBuffer(0));
        if (!read.some((l) => l.trim())) return { questions: [], issues: [{ source: "file", reason: "pdf_no_text" }] };
        return { ...parseQuestionLines(read, lang), text: read.join("\n") };
      } catch (e) {
        return { questions: [], issues: [{ source: "file", reason: (e as Error).message }] };
      }
  }
}

export function exportAs(format: ExportFormat, qs: ExportQuestion[], lang: "ar" | "en", files: Record<string, string>, course?: { code?: string | null; title?: string }, pdfAnswers?: PdfAnswers): ExportResult {
  switch (format) {
    case "moodle":
      return exportMoodle(qs, lang, files);
    case "json":
      return exportJson(qs, files, course);
    case "gift":
      return exportGift(qs, lang);
    case "aiken":
      return exportAiken(qs, lang);
    case "csv":
      return exportCsv(qs);
    case "pdf":
      return exportPdf(qs, lang, files, course, pdfAnswers);
  }
}

/** downloadable templates / examples */
export const TEMPLATES: Record<"csv" | "json" | "gift" | "aiken" | "moodle", { name: string; mime: string; text: () => string }> = {
  csv: { name: "questions-template.csv", mime: "text/csv", text: csvTemplate },
  json: {
    name: "questions-template.json",
    mime: "application/json",
    text: () =>
      JSON.stringify(
        {
          format: JSON_FORMAT,
          version: 1,
          questions: [
            {
              type: "MCQ",
              stemAr: "ما المخرج الرئيسي لعملية تطوير ميثاق المشروع؟",
              stemEn: "What is the main output of Develop Project Charter?",
              content: { options: [{ id: "o1", textAr: "خطة المشروع", textEn: "Project plan" }, { id: "o2", textAr: "ميثاق المشروع", textEn: "Project charter" }] },
              answer: { correct: ["o2"] },
              scoring: { mode: "ALL_OR_NOTHING" },
              points: 1,
              weight: 1,
              difficulty: "EASY",
              keywords: ["ميثاق"],
              reference: "PMBOK 7",
              feedbackAr: "",
              feedbackEn: "",
              explanationAr: "الميثاق يخوّل المشروع رسميًا.",
              explanationEn: "The charter formally authorizes the project.",
              optionRationale: { o1: { ar: "الخطة تأتي لاحقًا." } },
              category: { domain: "البدء" },
            },
            {
              type: "CLOZE",
              stemAr: "أكمل الفراغات.",
              stemEn: "",
              content: { textAr: "تبدأ إدارة المشروع بمرحلة [[1]] وتنتهي بمرحلة [[2]].", textEn: "", blanks: [{ id: "1", kind: "SELECT", options: [{ id: "a", textAr: "البدء", textEn: "" }, { id: "b", textAr: "التخطيط", textEn: "" }] }, { id: "2", kind: "TEXT" }] },
              answer: { blanks: { "1": { correct: "a" }, "2": { accepted: ["الإغلاق"], caseSensitive: false } } },
              scoring: { mode: "PARTIAL" },
              points: 2,
              difficulty: "MEDIUM",
            },
          ],
        },
        null,
        2,
      ),
  },
  gift: {
    name: "questions-template.gift.txt",
    mime: "text/plain",
    text: () =>
      [
        "// GIFT — كل سؤال يفصله سطر فارغ",
        "$CATEGORY: $course$/top/البدء",
        "",
        "::س1:: ما المخرج الرئيسي لعملية تطوير ميثاق المشروع؟ {=ميثاق المشروع ~خطة المشروع ~سجل المخاطر ####الميثاق يخوّل المشروع رسميًا.}",
        "",
        "::س2:: اختر عمليتين من مجموعة التخطيط {~%50%تحديد النطاق ~%50%إنشاء هيكل تجزئة العمل ~%-100%إغلاق المشروع}",
        "",
        "::س3:: سجل المخاطر مخرج من مخرجات عملية تحديد المخاطر. {T}",
        "",
        "::س4:: ما اختصار هيكل تجزئة العمل؟ {=WBS =W.B.S}",
        "",
        "::س5:: مؤشر أداء الجدول إذا كانت PV = 100 وEV = 80؟ {#0.8:0.01}",
        "",
        "::س6:: طابق كل عملية بمجموعتها {=تطوير الميثاق -> البدء =تحديد النطاق -> التخطيط =إغلاق المشروع -> الإغلاق}",
        "",
        "::س7:: اشرح الفرق بين المخاطر والقضايا. {}",
        "",
      ].join("\n"),
  },
  aiken: {
    name: "questions-template.aiken.txt",
    mime: "text/plain",
    text: () => ["ما المخرج الرئيسي لعملية تطوير ميثاق المشروع؟", "A. خطة المشروع", "B. ميثاق المشروع", "C. سجل المخاطر", "ANSWER: B", "", "What does WBS stand for?", "A) Work Breakdown Structure", "B) Work Budget Schedule", "ANSWER: A", ""].join("\n"),
  },
  moodle: {
    name: "questions-template.xml",
    mime: "application/xml",
    text: () =>
      `<?xml version="1.0" encoding="UTF-8"?>
<quiz>
  <question type="category"><category><text>$course$/top/البدء</text></category></question>
  <question type="multichoice">
    <name><text>ميثاق المشروع</text></name>
    <questiontext format="html"><text><![CDATA[<p>ما المخرج الرئيسي لعملية تطوير ميثاق المشروع؟</p>]]></text></questiontext>
    <generalfeedback format="html"><text><![CDATA[<p>الميثاق يخوّل المشروع رسميًا.</p>]]></text></generalfeedback>
    <defaultgrade>1</defaultgrade>
    <single>true</single>
    <answer fraction="100" format="html"><text>ميثاق المشروع</text></answer>
    <answer fraction="0" format="html"><text>خطة المشروع</text><feedback format="html"><text>الخطة تأتي لاحقًا.</text></feedback></answer>
  </question>
  <question type="truefalse">
    <name><text>سجل المخاطر</text></name>
    <questiontext format="html"><text>سجل المخاطر مخرج من مخرجات عملية تحديد المخاطر.</text></questiontext>
    <answer fraction="100"><text>true</text></answer>
    <answer fraction="0"><text>false</text></answer>
  </question>
  <question type="multianswer">
    <name><text>فراغات</text></name>
    <questiontext format="html"><text><![CDATA[<p>تبدأ إدارة المشروع بمرحلة {1:MULTICHOICE:=البدء~التخطيط} وتنتهي بمرحلة {1:SHORTANSWER:=الإغلاق}.</p>]]></text></questiontext>
  </question>
</quiz>
`,
  },
};
