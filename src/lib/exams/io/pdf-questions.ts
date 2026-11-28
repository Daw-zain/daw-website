/**
 * Question text (lines, e.g. read from a PDF) → questions. Each part goes to its own field:
 * question text, options, answer key (inline or collected at the end), explanation, feedback,
 * option notes, difficulty, points, category, reference and case study. Nothing is guessed:
 * a choice question without a stated answer is reported, not imported.
 *
 *   السؤال 1:  …نص السؤال…           Question 1: …   (or "1. …")
 *   أ) …   ب) …                      A) …  B) …      (a * or ✓ next to an option also marks it correct)
 *   الإجابة الصحيحة: ب                Answer: B  |  A, C  |  True  |  0.8 ± 0.01  |  WBS | W.B.S
 *   الشرح: …                          Explanation: …
 *   التغذية الراجعة: …                 Feedback: …
 *   مفتاح الإجابات  (a section at the end: "السؤال 1: ب" or "1) B", followed by الشرح / التغذية الراجعة)
 */
import type { QuestionType } from "../bank";
import { blankImport, item, pickLang, type ImportQuestion, type ImportScenario, type ParseResult, type TextLang } from "./types";

export const PDF_TYPES: QuestionType[] = ["MCQ", "MULTI", "TRUE_FALSE", "NUMERIC", "SHORT", "ESSAY", "ORDERING"];

/** comparable form of a label or word: no vowel marks, one alef, ة = ه, ى = ي */
export const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[ً-ٰٟـ]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/\s+/g, " ")
    .trim();
const latinDigits = (s: string) => s.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x660)).replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x6f0));

type Field = "answer" | "explanation" | "feedback" | "model" | "reference" | "difficulty" | "points" | "domain" | "topic" | "subtopic" | "keywords" | "type" | "tolerance";

const LABELS: Record<Field, string[]> = {
  answer: ["الإجابة الصحيحة", "الإجابات الصحيحة", "الإجابة", "الإجابات", "الجواب الصحيح", "الجواب", "مفتاح الإجابة", "الحل", "correct answer", "correct answers", "answer", "answers", "ans", "key", "answer key"],
  explanation: ["الشرح", "شرح الإجابة", "شرح", "التعليل", "التفسير", "explanation", "rationale", "justification"],
  feedback: ["التغذية الراجعة", "تغذية راجعة", "التعليق على الإجابة", "feedback", "general feedback"],
  model: ["نموذج الإجابة", "الإجابة النموذجية", "model answer", "rubric", "marking guide"],
  reference: ["المرجع", "reference"],
  difficulty: ["الصعوبة", "مستوى الصعوبة", "difficulty"],
  points: ["الدرجة", "النقاط", "العلامة", "points", "marks", "score"],
  domain: ["المجال", "domain"],
  topic: ["الموضوع", "topic"],
  subtopic: ["الموضوع الفرعي", "subtopic"],
  keywords: ["الكلمات المفتاحية", "keywords"],
  type: ["نوع السؤال", "النوع", "question type", "type"],
  tolerance: ["هامش الخطأ", "التفاوت المسموح", "tolerance"],
};
const FIELD_OF = new Map<string, Field>(Object.entries(LABELS).flatMap(([f, list]) => list.map((l) => [norm(l), f as Field])));

const SINGLE_LINE = new Set<Field>(["type", "difficulty", "points", "tolerance"]);

const TYPE_NAMES = new Map<string, QuestionType>(
  (
    [
      ["MCQ", ["mcq", "multiple choice", "اختيار من متعدد"]],
      ["MULTI", ["multi", "multiple response", "multiple responses", "متعدد الإجابات", "متعدد الاستجابات"]],
      ["TRUE_FALSE", ["true/false", "true or false", "صح أو خطأ", "صح/خطأ", "صواب أو خطأ"]],
      ["NUMERIC", ["numeric", "numerical", "رقمي", "عددي"]],
      ["SHORT", ["short answer", "short", "إجابة قصيرة"]],
      ["ESSAY", ["essay", "مقالي"]],
      ["ORDERING", ["ordering", "order", "ترتيب"]],
    ] as [QuestionType, string[]][]
  ).flatMap(([t, names]) => names.map((n) => [norm(n), t] as [string, QuestionType])),
);

const KEY_HEADINGS = new Set(["مفتاح الإجابات", "مفاتيح الإجابات", "مفتاح الإجابة", "مفاتيح الإجابة", "مفتاح الحل", "الإجابات الصحيحة", "الإجابات", "إجابات الأسئلة", "answer key", "answer keys", "answers", "answers and explanations", "الإجابات والشرح", "مفتاح الإجابات والشرح"].map(norm));
const SECTION_HEADINGS = new Map<string, Field>([...["الشروحات", "شرح الإجابات", "الشرح", "التعليلات", "explanations"].map((h) => [norm(h), "explanation"] as [string, Field]), ...["التغذية الراجعة", "feedback"].map((h) => [norm(h), "feedback"] as [string, Field])]);
const END_MARK = /^[-–—=*\s]*(?:نهايه ملف الاسيله|نهايه ملف الاسئله|end of question file)[-–—=*\s]*$/;
const CASE_END = /^[-–—=*\s]*(?:نهايه دراسه الحاله|end of case study)[-–—=*\s]*$/;

const TRUE_WORDS = new Set(["صح", "صحيح", "صحيحه", "صواب", "نعم", "true", "t", "yes"].map(norm));
const FALSE_WORDS = new Set(["خطا", "خطأ", "خاطئ", "خاطئه", "غير صحيح", "لا", "false", "f", "no"].map(norm));
const asBool = (s: string): boolean | null => {
  const v = norm(s.replace(/[.،!]+$/, ""));
  return TRUE_WORDS.has(v) ? true : FALSE_WORDS.has(v) ? false : null;
};

/* ───────── option letters ───────── */

const SEQUENCES = [
  ["a", "b", "c", "d", "e", "f", "g", "h"],
  ["ا", "ب", "ج", "د", "ه", "و", "ز", "ح"], // أبجد
  ["ا", "ب", "ت", "ث", "ج", "ح", "خ", "د"], // ألفباء
];
const letterKey = (l: string) => norm(l).replace(/^هـ?$/, "ه");
const OPTION = /^[*✓✔√\s]*[([]?\s*([A-Ha-h]|هـ|[أاإبتثجحخدهوز])\s?[.)(\]\-–:]\s*(\S.*)$/;
const MARK = /\s*(?:[*✓✔√]+|[([]\s*(?:correct|الإجابة الصحيحة|الصحيحة|صحيح)\s*[)\]])\s*/i;

type Option = { letter: string; text: string; correct: boolean };
type Draft = {
  source: string;
  number: number | null;
  stem: string[];
  options: Option[];
  fields: Partial<Record<Field, string[]>>;
  notes: Record<string, string[]>; // option letter → note
  scenario?: ImportScenario;
  warnings: string[];
};

const ANSWERISH = /^(?:(?:[A-Ha-h]|هـ|[أابتثجحخدهوز])(?:[\s,،+و]+(?:[A-Ha-h]|هـ|[أابتثجحخدهوز]))*|صح|خطأ|صحيح|خاطئ|true|false|-?\d[\d.,]*(?:\s*±\s*[\d.,]+)?)[.\s]*(?:$|\s[—–-]\s)/i;
const QUESTION_WORD = /^(?:السؤال|سؤال|question|q)\s*(?:رقم\s*|no\.?\s*|#\s*)?(\d{1,4})(?!\d)\s*[.:)(\-–—]*\s*(.*)$/i;
const NUMBERED = /^[(.]?\s*(\d{1,4})\s?[.)(\-–:](?!\d)\s*(.*)$/;

/** an option line, if its letter is the next one of the running list */
function optionAt(line: string, have: Option[]): Option | null {
  const m = line.match(OPTION);
  if (!m) return null;
  const letters = [...have.map((o) => o.letter), letterKey(m[1])];
  if (!SEQUENCES.some((s) => letters.every((l, i) => s[i] === l))) return null;
  const marked = /^[*✓✔√]/.test(line.trim()) || MARK.test(m[2].match(new RegExp(`${MARK.source}$`, "i"))?.[0] ?? "") || /^[*✓✔√]/.test(m[2]);
  const text = m[2].replace(new RegExp(`^[*✓✔√]+\\s*|${MARK.source}$`, "gi"), "").trim();
  return { letter: letterKey(m[1]), text, correct: marked };
}

/** "A) x   B) y   C) z" on one line → separate pieces */
const splitInline = (line: string) => line.split(/\s{2,}(?=[([]?\s*(?:[B-Hb-h]|[بتثجحخدهوز]|هـ)\s?[.)(\]])/);

function labelOf(line: string): { field: Field; value: string } | { note: string; value: string } | null {
  const m = line.match(/^[•\-–\s]*([^:：]{1,40}?)\s*[:：]\s*(.*)$/);
  if (!m) return null;
  const head = norm(m[1].replace(/[()[\]]/g, " "));
  const field = FIELD_OF.get(head);
  if (field) return { field, value: m[2].trim() };
  const note = head.match(/^(?:تعليل الخيار|ملاحظه الخيار|تعليل|لماذا ليس|why not|rationale for|rationale|option note)\s+(?:الخيار\s+|option\s+)?([a-h]|هـ|[ابتثجحخدهوز])$/);
  return note ? { note: letterKey(note[1]), value: m[2].trim() } : null;
}

const join = (parts: string[] | undefined) =>
  (parts ?? [])
    .join("\n")
    .split(/\n{2,}/)
    .map((p) => p.replace(/\n/g, " ").replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");

export function parseQuestionLines(input: string[], lang: TextLang = "auto"): ParseResult {
  const lines = input.map((l) => l.replace(/[‎‏‪-‮⁦-⁩]/g, "").trim());
  const drafts: Draft[] = [];
  const keys: { number: number; fields: Partial<Record<Field, string[]>>; notes: Record<string, string[]> }[] = [];
  const preamble: string[] = [];

  let cur: Draft | null = null;
  /** where a following unlabelled line belongs */
  let into: { kind: "stem" } | { kind: "option" } | { kind: "field"; field: Field } | { kind: "note"; letter: string } = { kind: "stem" };
  let scenario: ImportScenario | undefined;
  let caseBody: string[] | null = null;
  let inKey = false;
  let keySection: Field = "answer";
  /** the key writes "Question 3": numbered lines inside it are lists in the explanations */
  let keyWorded = false;
  let key: (typeof keys)[number] | null = null;
  let gap = false;
  /** the file writes "Question 3": then numbered lines are lists inside the text, not new questions */
  let worded = false;

  const push = (list: string[], text: string) => {
    if (gap && list.length) list.push("");
    list.push(text);
  };
  const add = (target: Partial<Record<Field, string[]>>, field: Field, text: string) => {
    const list = (target[field] ??= []);
    if (text) push(list, text);
  };
  const start = (number: number | null, text: string, source: string) => {
    if (caseBody) closeCase();
    cur = { source, number, stem: text ? [text] : [], options: [], fields: {}, notes: {}, scenario, warnings: [] };
    drafts.push(cur);
    into = { kind: "stem" };
  };
  const closeCase = () => {
    if (scenario && caseBody) {
      const body = join(caseBody);
      const L = pickLang(lang, body || scenario.key);
      scenario[L === "ar" ? "bodyAr" : "bodyEn"] = body;
    }
    caseBody = null;
  };
  /** do options follow before the next labelled line? then an unnumbered question starts here */
  const optionsAhead = (i: number) => {
    for (let j = i + 1, seen = 0; j < lines.length && seen < 6; j++) {
      if (!lines[j]) continue;
      seen++;
      if (labelOf(lines[j])) return false;
      if (optionAt(lines[j], [])) return true;
    }
    return false;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) {
      gap = true;
      continue;
    }
    const plain = latinDigits(line);
    const heading = norm(plain.replace(/^[-–—=*#\s]+|[-–—=*#:：\s]+$/g, ""));
    if (END_MARK.test(norm(plain))) break;

    /* ── the answer key section ── */
    const nextLine = latinDigits(lines.slice(i + 1).find((l) => l) ?? "");
    if (!inKey && drafts.length && KEY_HEADINGS.has(heading) && !/[:：]\s*\S/.test(line) && (QUESTION_WORD.test(nextLine) || /^\D{0,2}\d/.test(nextLine))) {
      inKey = true;
      keySection = "answer";
      gap = false;
      continue;
    }
    if (inKey) {
      if (SECTION_HEADINGS.has(heading) && !/[:：]\s*\S/.test(line)) {
        keySection = SECTION_HEADINGS.get(heading)!;
        key = null;
        gap = false;
        continue;
      }
      const pairs = [...plain.matchAll(/(?:^|\s)(\d{1,4})\s?[.)(\-:=–]?\s*((?:[A-Ha-h]|هـ|[أابتثجحخدهوز])(?:\s?[,،+]\s?(?:[A-Ha-h]|هـ|[أابتثجحخدهوز]))*|صح|خطأ|True|False)(?=\s+\d{1,4}\s?[.)(\-:=–]?\s|\s*$)/gi)];
      if (keySection === "answer" && pairs.length > 1 && pairs.map((p) => p[0]).join("").replace(/\s/g, "") === plain.replace(/\s/g, "")) {
        for (const p of pairs) keys.push({ number: Number(p[1]), fields: { answer: [p[2]] }, notes: {} });
        key = null;
        gap = false;
        continue;
      }
      const label = labelOf(line);
      const word = plain.match(QUESTION_WORD);
      const listed = keyWorded ? null : (plain.match(NUMBERED) ?? plain.match(/^(\d{1,4})\s+((?:[A-Ha-h]|هـ|[أابتثجحخدهوز]|صح|خطأ|True|False))$/i));
      // after the first entry a numbered line opens the next one only if it reads like an answer
      const opens: boolean = !!listed && (!key || ANSWERISH.test(listed[2]) || !!labelOf(listed[2]) || !listed[2] || (Number(listed[1]) === key.number + 1 && listed[2].length <= 40));
      const num: RegExpMatchArray | null = word ?? (opens ? listed : null);
      if (word) keyWorded = true;
      if (num && (!label || word)) {
        key = { number: Number(num[1]), fields: {}, notes: {} };
        keys.push(key);
        const rest = line.slice(line.length - num[2].length).trim();
        const inner = rest ? labelOf(rest) : null;
        if (inner && "field" in inner) {
          add(key.fields, inner.field, inner.value);
          into = { kind: "field", field: inner.field };
        } else if (keySection !== "answer") {
          add(key.fields, keySection, rest);
          into = { kind: "field", field: keySection };
        } else {
          // "B — why" : the answer, then an explanation
          const parts = rest.match(/^(.{1,40}?)\s+[—–-]\s+(.+)$/);
          add(key.fields, "answer", parts ? parts[1] : rest);
          if (parts) add(key.fields, "explanation", parts[2]);
          into = { kind: "field", field: parts ? "explanation" : "answer" };
        }
      } else if (key && label) {
        if ("field" in label) {
          add(key.fields, label.field, label.value);
          into = { kind: "field", field: label.field };
        } else {
          (key.notes[label.note] ??= []).push(label.value);
          into = { kind: "note", letter: label.note };
        }
      } else if (key) {
        const t = into;
        if (t.kind === "note") push((key.notes[t.letter] ??= []), line);
        else {
          const field = t.kind === "field" ? t.field : "explanation";
          // a one-letter answer is complete: text under it explains it
          add(key.fields, field === "answer" && /^(\S{1,2}([\s,،+]+\S{1,2})*)$/.test(join(key.fields.answer)) ? "explanation" : field, line);
        }
      }
      gap = false;
      continue;
    }

    /* ── case study ── */
    if (CASE_END.test(norm(plain))) {
      closeCase();
      scenario = undefined;
      cur = null;
      gap = false;
      continue;
    }
    const caseStart = line.match(/^(?:دراسة الحالة|دراسه الحاله|case study|scenario)\s*[:：]\s*(.*)$/i);
    if (caseStart) {
      closeCase();
      const title = caseStart[1].trim() || `case-${drafts.length + 1}`;
      const L = pickLang(lang, title);
      scenario = { key: title, titleAr: L === "ar" ? title : "", titleEn: L === "en" ? title : "", bodyAr: "", bodyEn: "", displayMode: "SIDE" };
      caseBody = [];
      cur = null;
      gap = false;
      continue;
    }

    /* ── a new question ── */
    const word = plain.match(QUESTION_WORD);
    if (word) {
      worded = true;
      start(Number(word[1]), line.slice(line.length - word[2].length).trim(), `Q${word[1]}`);
      gap = false;
      continue;
    }
    const num = plain.match(NUMBERED);
    // `cur` may be null at the start; a numbered line must be the next number (lists inside text are not questions)
    const c = cur as Draft | null;
    if (!worded && num && num[2] && ((!c && (!caseBody || optionsAhead(i) || Number(num[1]) === drafts.length + 1)) || (c && c.number !== null && (Number(num[1]) === c.number + 1 || (Number(num[1]) === 1 && !!c.fields.answer))))) {
      start(Number(num[1]), line.slice(line.length - num[2].length).trim(), `Q${num[1]}`);
      gap = false;
      continue;
    }
    // a plainly written next question inside a file that otherwise says "Question 3"
    if (worded && num && num[2] && c && c.number !== null && Number(num[1]) === c.number + 1 && !!c.fields.answer && !!optionAt(lines.slice(i + 1).find((l) => l) ?? "", [])) {
      start(Number(num[1]), line.slice(line.length - num[2].length).trim(), `Q${num[1]}`);
      gap = false;
      continue;
    }
    if (caseBody) {
      push(caseBody, line);
      gap = false;
      continue;
    }

    const label = labelOf(line);
    if (!c) {
      const first = optionAt(line, []);
      if (first && preamble.length) {
        // an unnumbered question: its text is the block just above the first option
        const from = preamble.lastIndexOf("") + 1;
        start(null, preamble.slice(from).join("\n"), `Q${drafts.length + 1}`);
        preamble.length = 0;
        (cur as unknown as Draft).options.push(first);
        into = { kind: "option" };
      } else push(preamble, line);
      gap = false;
      continue;
    }

    /* ── parts of the current question ── */
    if (label) {
      if ("field" in label) {
        add(c.fields, label.field, label.value);
        // "Question type: …" and the like take one line: before the options, the question text follows
        into = !c.options.length && SINGLE_LINE.has(label.field) && label.value ? { kind: "stem" } : { kind: "field", field: label.field };
      } else {
        (c.notes[label.note] ??= []).push(label.value);
        into = { kind: "note", letter: label.note };
      }
      gap = false;
      continue;
    }
    const answered = Object.keys(c.fields).some((f) => f === "answer" || f === "explanation" || f === "feedback" || f === "model");
    if (!answered) {
      let took = false;
      for (const part of splitInline(line)) {
        const o = optionAt(part, c.options);
        if (o) {
          c.options.push(o);
          into = { kind: "option" };
          took = true;
        } else if (took) c.options[c.options.length - 1].text += ` ${part}`;
        else break;
      }
      if (took) {
        gap = false;
        continue;
      }
    }
    if (c.number === null && (answered ? gap || into.kind === "field" : gap && c.options.length >= 2) && optionsAhead(i)) {
      start(null, line, `Q${drafts.length + 1}`);
      gap = false;
      continue;
    }
    const t = into as { kind: string; field?: Field; letter?: string };
    if (t.kind === "stem") push(c.stem, line);
    else if (t.kind === "option") c.options[c.options.length - 1].text += ` ${line}`;
    else if (t.kind === "note") push((c.notes[t.letter!] ??= []), line);
    else if (t.field === "answer" && c.options.length) {
      add(c.fields, "explanation", line);
      into = { kind: "field", field: "explanation" };
      c.warnings.push("text_after_answer");
    } else add(c.fields, t.field!, line);
    gap = false;
  }
  closeCase();

  // the key section completes the questions it numbers (the n-th "1" goes to the n-th question 1)
  const used = new Map<number, number>();
  const unmatched: number[] = [];
  const numbered = drafts.some((d) => d.number !== null);
  for (const k of keys) {
    const same = numbered ? drafts.filter((d) => d.number === k.number) : drafts.slice(k.number - 1, k.number);
    const nth = used.get(k.number) ?? 0;
    const d = same[nth];
    if (!d) {
      unmatched.push(k.number);
      continue;
    }
    used.set(k.number, nth + 1);
    for (const [f, v] of Object.entries(k.fields) as [Field, string[]][]) if (v.length && !join(d.fields[f])) d.fields[f] = v;
    for (const [l, v] of Object.entries(k.notes)) d.notes[l] ??= v;
  }

  const res: ParseResult = { questions: [], issues: [] };
  for (const d of drafts) build(d, lang, res);
  for (const n of unmatched) res.issues.push({ source: `Q${n}`, reason: "key_without_question" });
  if (!drafts.length) res.issues.push({ source: "file", reason: "no_questions_found" });
  return res;
}

/** which options does the answer text name? null when it cannot be read with certainty */
function chosen(answer: string, options: Option[]): number[] | null {
  const clean = answer.replace(/[.。]+$/, "").trim();
  const exact = options.findIndex((o) => norm(o.text.replace(/[.]+$/, "")) === norm(clean));
  if (exact >= 0) return [exact];
  const index = (l: string) => {
    const k = letterKey(l);
    const at = options.findIndex((o) => o.letter === k);
    return at >= 0 ? at : null;
  };
  // "B) Project charter"
  const lead = clean.match(/^[([]?\s*([A-Ha-h]|هـ|[أاإبتثجحخدهوز])\s?[.)(\]\-–:]\s*(\S.*)$/);
  if (lead) {
    const at = index(lead[1]);
    if (at !== null && norm(options[at].text).startsWith(norm(lead[2]).slice(0, 12))) return [at];
  }
  const tokens = clean
    .replace(/[()[\]]/g, " ")
    .split(/[\s,،;؛+&/|]+|\.(?=\s|$)/)
    .flatMap((t) => (/^و[بتثجحخدهز]$/.test(t) ? [t.slice(1)] : [t]))
    .filter((t) => t && !["و", "and", "&"].includes(t.toLowerCase()));
  const found = tokens.map(index);
  if (!tokens.length || found.some((x) => x === null)) return null;
  return [...new Set(found as number[])];
}

function build(d: Draft, lang: TextLang, res: ParseResult) {
  const f = (k: Field) => join(d.fields[k]);
  const stem = join(d.stem);
  const fail = (reason: string, detail?: string) => void res.issues.push({ source: d.source, reason, detail });
  if (!stem) return fail("no_stem");
  const L = pickLang(lang, stem);
  const warnings = [...new Set(d.warnings)];
  const answer = f("answer");
  let declared = f("type") ? TYPE_NAMES.get(norm(f("type").replace(/\s*[([].*$/, ""))) : undefined;
  if (f("type") && !declared) return fail("unsupported_type", f("type"));
  let options = d.options.filter((o) => o.text);
  // "True / False" written as two options
  const tfOptions = options.length === 2 && options.every((o) => asBool(o.text) !== null);
  if (tfOptions && !declared) declared = "TRUE_FALSE";

  const q: ImportQuestion = blankImport("MCQ", L, stem);
  const ids = options.map((o) => item(o.text, L));
  if (declared === "TRUE_FALSE" || (!declared && !options.length && asBool(answer) !== null)) {
    const marked = options.findIndex((o) => o.correct);
    const named = tfOptions && asBool(answer) === null && answer ? chosen(answer, options) : null;
    const value = asBool(answer) ?? (named?.length === 1 ? asBool(options[named[0]].text) : marked >= 0 && !answer ? asBool(options[marked].text) : null);
    if (value === null) return fail("no_correct_answer", answer || undefined);
    q.type = "TRUE_FALSE";
    q.answer = { value };
    options = [];
  } else if (declared === "ORDERING") {
    if (options.length < 2) return fail("options_missing");
    const order = answer ? chosen(answer, options) : options.map((_, i) => i);
    if (!order || order.length !== options.length) return fail("no_correct_answer", answer);
    q.type = "ORDERING";
    q.content = { items: order.map((i) => ids[i]) };
    q.scoring = { mode: "PARTIAL" };
  } else if (options.length || declared === "MCQ" || declared === "MULTI") {
    if (options.length < 2) return fail("options_missing");
    const marked = options.map((o, i) => (o.correct ? i : -1)).filter((i) => i >= 0);
    const named = answer ? chosen(answer, options) : null;
    if (answer && !named) return fail("answer_not_matched", answer);
    const right = named ?? marked;
    if (!right.length) return fail("no_correct_answer");
    if (named && marked.length && [...named].sort().join() !== marked.join()) return fail("answer_conflict", answer);
    if (declared === "MCQ" && right.length > 1) return fail("answer_conflict", answer);
    q.type = declared === "MULTI" || right.length > 1 ? "MULTI" : "MCQ";
    q.content = { options: ids };
    q.answer = { correct: right.map((i) => ids[i].id) };
    if (q.type === "MULTI") q.scoring = { mode: "PARTIAL" };
  } else {
    const num = latinDigits(answer).replace(/٫/g, ".").match(/^(-?\d+(?:[.,]\d+)?)\s*%?\s*(?:(?:±|\+\/-|\+-)\s*(\d+(?:[.,]\d+)?))?$/);
    const model = f("model");
    if (declared === "NUMERIC" || (!declared && num)) {
      if (!num) return fail("no_correct_answer", answer || undefined);
      q.type = "NUMERIC";
      q.answer = { value: Number(num[1].replace(",", ".")), tolerance: Math.abs(Number((num[2] ?? latinDigits(f("tolerance"))).replace(",", ".")) || 0) };
    } else if (declared === "SHORT" || (!declared && !model && answer && answer.length <= 80)) {
      const accepted = answer.split(/\s*[|؛]\s*/).filter(Boolean);
      if (!accepted.length) return fail("no_correct_answer");
      q.type = "SHORT";
      q.answer = { accepted, caseSensitive: false };
    } else if (declared === "ESSAY" || model || answer) {
      const rubric = model || answer;
      q.type = "ESSAY";
      q.scoring = { mode: "MANUAL" };
      q.answer = L === "ar" ? { rubricAr: rubric, rubricEn: "" } : { rubricAr: "", rubricEn: rubric };
    } else return fail("no_correct_answer");
  }

  const set = (key: "feedback" | "explanation", value: string) => {
    if (L === "ar") q[`${key}Ar`] = value;
    else q[`${key}En`] = value;
  };
  set("feedback", f("feedback"));
  set("explanation", f("explanation"));
  for (const [letter, parts] of Object.entries(d.notes)) {
    const at = d.options.findIndex((o) => o.letter === letter);
    if (at >= 0 && ids[at]) q.optionRationale[ids[at].id] = { [L]: join(parts) };
    else warnings.push("note_ignored");
  }
  const pts = Number(latinDigits(f("points")).replace(",", ".").match(/\d+(\.\d+)?/)?.[0]);
  if (pts > 0) q.points = pts;
  if (f("difficulty")) {
    const level = ({ easy: "EASY", medium: "MEDIUM", hard: "HARD", سهل: "EASY", متوسط: "MEDIUM", صعب: "HARD" } as Record<string, ImportQuestion["difficulty"]>)[norm(f("difficulty"))];
    if (level) q.difficulty = level;
    else warnings.push("difficulty_default");
  }
  if (f("domain")) q.category = { domain: f("domain"), topic: f("topic") || undefined, subtopic: f("subtopic") || undefined };
  q.reference = f("reference");
  q.keywords = f("keywords").split(/[,،|]/).map((k) => k.trim()).filter(Boolean);
  if (d.scenario) q.scenario = d.scenario;
  res.questions.push({ q, source: d.source, warnings, files: [] });
}
