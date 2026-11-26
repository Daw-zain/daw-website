// Phase 11 — file readers/writers (no database). run: npx tsx scripts/test-exams-io.ts
import { deflateRawSync } from "node:zlib";
import { exportAs, parseFile, TEMPLATES, type ExportQuestion, type ImportQuestion, type ParsedQuestion } from "../src/lib/exams/io";
import { parseMoodle } from "../src/lib/exams/io/moodle";
import { htmlToText } from "../src/lib/exams/io/html";
import { parseXml } from "../src/lib/exams/io/xml";

const results: { name: string; pass: boolean; info: string }[] = [];
const ok = (name: string, pass: unknown, info = "") => results.push({ name, pass: !!pass, info });
const types = (qs: ParsedQuestion[]) => qs.map((p) => p.q.type).join(",");
const asExport = (qs: ParsedQuestion[]): ExportQuestion[] => qs.map((p, i) => ({ ...p.q, id: `q${i}`, status: "ACTIVE", version: 1, attachments: [] }));
const T = (q: ImportQuestion) => q.stemAr || q.stemEn;

async function main() {
  // ── templates parse as advertised ──
  let r = await parseFile("moodle", { text: TEMPLATES.moodle.text() }, "auto");
  ok("Moodle template: MCQ, TRUE_FALSE, CLOZE", types(r.questions) === "MCQ,TRUE_FALSE,CLOZE" && r.issues.length === 0, types(r.questions) + JSON.stringify(r.issues));
  const mcq = r.questions[0].q;
  ok("Moodle: Arabic text goes to the Arabic fields; right option, feedback, option rationale, category kept",
    mcq.stemAr.startsWith("ما المخرج") && !mcq.stemEn && mcq.answer.correct?.length === 1 && mcq.content.options?.find((o) => o.id === mcq.answer.correct![0])?.textAr === "ميثاق المشروع"
      && mcq.feedbackAr === "الميثاق يخوّل المشروع رسميًا." && Object.values(mcq.optionRationale)[0]?.ar === "الخطة تأتي لاحقًا." && mcq.category?.domain === "البدء", JSON.stringify(mcq));
  const cz = r.questions[2].q;
  ok("Moodle Cloze (multianswer) → CLOZE with a drop-down and a typed blank", cz.content.blanks?.map((b) => b.kind).join() === "SELECT,TEXT" && cz.content.textAr?.includes("[[1]]") && cz.content.textAr.includes("[[2]]") && cz.answer.blanks?.["2"]?.accepted?.[0] === "الإغلاق", JSON.stringify(cz.content));

  r = await parseFile("gift", { text: TEMPLATES.gift.text() }, "auto");
  ok("GIFT template: 7 types", types(r.questions) === "MCQ,MULTI,TRUE_FALSE,SHORT,NUMERIC,MATCHING,ESSAY" && !r.issues.length, types(r.questions) + JSON.stringify(r.issues));
  const gm = r.questions[1].q;
  ok("GIFT weights: two right options, negative weight → partial with penalty", gm.answer.correct?.length === 2 && gm.scoring.mode === "PARTIAL_PENALTY", JSON.stringify(gm.answer) + gm.scoring.mode);
  ok("GIFT numeric value:tolerance", r.questions[4].q.answer.value === 0.8 && r.questions[4].q.answer.tolerance === 0.01, JSON.stringify(r.questions[4].q.answer));
  ok("GIFT general feedback (####) and category", r.questions[0].q.feedbackAr === "الميثاق يخوّل المشروع رسميًا." && r.questions[0].q.category?.domain === "البدء", r.questions[0].q.feedbackAr);

  r = await parseFile("aiken", { text: TEMPLATES.aiken.text() }, "auto");
  ok("Aiken template: 2 MCQ (Arabic and English detected)", types(r.questions) === "MCQ,MCQ" && !!r.questions[0].q.stemAr && !!r.questions[1].q.stemEn && !r.issues.length, types(r.questions) + JSON.stringify(r.issues));

  r = await parseFile("csv", { text: TEMPLATES.csv.text() }, "auto");
  ok("CSV template: 7 simple types", types(r.questions) === "MCQ,MULTI,TRUE_FALSE,NUMERIC,SHORT,ESSAY,ORDERING" && !r.issues.length, types(r.questions) + JSON.stringify(r.issues));
  ok("CSV: letter answer, tolerance, difficulty, category, explanation", r.questions[0].q.content.options?.[1].id === r.questions[0].q.answer.correct?.[0] && r.questions[3].q.answer.tolerance === 0.01 && r.questions[0].q.difficulty === "EASY" && r.questions[0].q.category?.domain === "البدء" && r.questions[0].q.explanationAr !== "", "");

  r = await parseFile("json", { text: TEMPLATES.json.text() }, "auto");
  ok("JSON template: MCQ + CLOZE, both languages kept", types(r.questions) === "MCQ,CLOZE" && r.questions[0].q.stemEn.startsWith("What") && r.questions[0].q.explanationEn !== "", types(r.questions));

  // ── refusals with reasons ──
  r = await parseFile("csv", { text: "type,stem_ar,options_ar,correct\nMCQ,سؤال,أ|ب,C\nHOTSPOT,صورة,,\nTRUE_FALSE,عبارة,,ربما\n,,,\n" }, "auto");
  ok("CSV: wrong answer letter / unsupported type / bad true-false are reported, not imported", r.questions.length === 0 && r.issues.map((x) => x.reason).join() === "no_correct_answer,unsupported_type,no_correct_answer", JSON.stringify(r.issues));
  r = await parseFile("csv", { text: "type;stem_ar;options_ar;correct\r\nMCQ;\"سؤال; فيه فاصلة\";أ|ب;1\r\n" }, "auto");
  ok("CSV: semicolon delimiter and quoted cells detected", r.questions.length === 1 && r.questions[0].q.stemAr === "سؤال; فيه فاصلة", JSON.stringify(r));
  r = await parseFile("moodle", { text: "<quiz><question type=\"calculated\"><name><text>x</text></name><questiontext><text>a</text></questiontext></question><question type=\"multichoice\"><questiontext><text>b</text></questiontext><answer fraction=\"0\"><text>x</text></answer></question></quiz>" }, "auto");
  ok("Moodle: unsupported type and question without a right answer are reported", r.questions.length === 0 && r.issues.map((x) => x.reason).join() === "unsupported_type,no_correct_answer", JSON.stringify(r.issues));
  r = await parseFile("moodle", { text: "<quiz><question type='truefalse'>" }, "auto");
  ok("Moodle: broken XML → one clear issue", r.issues[0]?.reason === "bad_xml", JSON.stringify(r.issues));
  r = await parseFile("gift", { text: "سؤال بلا إجابة\n\n::t:: {=a}\n" }, "auto");
  ok("GIFT: block without answers and question without text are reported", r.issues.map((x) => x.reason).join() === "no_answer_block,no_stem", JSON.stringify(r.issues));

  // ── Moodle extras ──
  const matchingShared = `<quiz><question type="matching"><questiontext><text>صنّف</text></questiontext>
    <subquestion><text>أ</text><answer><text>مجموعة 1</text></answer></subquestion>
    <subquestion><text>ب</text><answer><text>مجموعة 1</text></answer></subquestion>
    <subquestion><text>ج</text><answer><text>مجموعة 2</text></answer></subquestion></question></quiz>`;
  r = await parseFile("moodle", { text: matchingShared }, "auto");
  ok("Moodle matching where items share an answer → DRAGDROP (zones hold several items)", r.questions[0]?.q.type === "DRAGDROP" && r.questions[0].q.content.zones?.length === 2, types(r.questions));
  const gapselect = `<quiz><question type="gapselect"><questiontext format="html"><text><![CDATA[<p>The [[1]] sat on the [[2]].</p>]]></text></questiontext>
    <selectoption><text>cat</text><group>1</group></selectoption><selectoption><text>mat</text><group>2</group></selectoption>
    <selectoption><text>dog</text><group>1</group></selectoption><selectoption><text>hat</text><group>2</group></selectoption></question></quiz>`;
  r = await parseFile("moodle", { text: gapselect }, "auto");
  const gs = r.questions[0]?.q;
  ok("Moodle gapselect → CLOZE: each blank offers its group, right choice kept", gs?.type === "CLOZE" && gs.content.textEn === "The [[1]] sat on the [[2]]." && gs.content.blanks?.[0].options?.map((o) => o.textEn).join() === "cat,dog" && gs.answer.blanks?.["2"]?.correct === "c2", JSON.stringify(gs?.content));
  const withImg = `<quiz><question type="truefalse"><questiontext format="html"><text><![CDATA[<p>انظر <img src="@@PLUGINFILE@@/a.png"></p><script>alert(1)</script>]]></text><file name="a.png" path="/" encoding="base64">iVBORw0KGgo=</file><file name="x.exe" encoding="base64">AAAA</file></questiontext><answer fraction="100"><text>false</text></answer><answer fraction="0"><text>true</text></answer></question></quiz>`;
  r = await parseFile("moodle", { text: withImg }, "auto");
  ok("Moodle embedded image becomes an attachment; other file types skipped with a warning; script dropped", r.questions[0]?.files.length === 1 && r.questions[0].files[0].mime === "image/png" && r.questions[0].warnings.some((w) => w.startsWith("file_skipped")) && r.questions[0].q.stemAr === "انظر" && r.questions[0].q.answer.value === false, JSON.stringify(r.questions[0]?.q.stemAr));

  // ── round trips ──
  const gift = await parseFile("gift", { text: TEMPLATES.gift.text() }, "auto");
  const csv = await parseFile("csv", { text: TEMPLATES.csv.text() }, "auto");
  const json = await parseFile("json", { text: TEMPLATES.json.text() }, "auto");
  const all = asExport([...gift.questions, ...csv.questions, ...json.questions]);
  // add an advanced question with a figure, a drag & drop (no distractor) and a hotspot
  all.push({ ...all[0], id: "fig", content: { ...all[0].content, figure: { kind: "BAR", captionAr: "رسم", captionEn: "", rows: [["a", "b"], ["x", "1"]] } } });
  all.push({ ...all[0], id: "dd", type: "DRAGDROP", content: { items: [{ id: "i1", textAr: "عنصر", textEn: "" }, { id: "i2", textAr: "آخر", textEn: "" }], zones: [{ id: "z1", textAr: "منطقة", textEn: "" }] }, answer: { placements: { i1: "z1", i2: "z1" } }, optionRationale: {} });
  all.push({ ...all[0], id: "hs", type: "HOTSPOT", content: {}, answer: { regions: [{ id: "r", x: 1, y: 1, w: 5, h: 5 }] }, optionRationale: {} });

  const mx = exportAs("moodle", all, "ar", {});
  ok("Moodle export: hotspot skipped with a reason, everything else exported", mx.skipped.length === 1 && mx.skipped[0].type === "HOTSPOT" && mx.exported === all.length - 1, JSON.stringify(mx.skipped));
  const back = parseMoodle(mx.text, "auto");
  const same = (a: ImportQuestion, b: ImportQuestion) => a.type === b.type && T(a) === T(b) && JSON.stringify(a.answer) === JSON.stringify(b.answer) && a.explanationAr === b.explanationAr && JSON.stringify(a.content) === JSON.stringify(b.content);
  ok("Moodle round trip (our export → import) loses nothing: types, answers, explanation, figure", back.questions.length === all.length - 1 && back.questions.every((p, i) => same(p.q, all.filter((x) => x.type !== "HOTSPOT")[i])) && !back.issues.length, JSON.stringify(back.issues));
  // the same file read the way Moodle reads it (without our <daleel> element)
  const plain = parseMoodle(mx.text.replace(/<daleel>[\s\S]*?<\/daleel>/g, ""), "auto");
  const ptypes = plain.questions.map((p) => p.q.type).join(",");
  ok("Moodle native fields alone rebuild every question type correctly",
    !plain.issues.length && ptypes === all.filter((x) => x.type !== "HOTSPOT").map((x) => (x.type === "DRAGDROP" ? "DRAGDROP" : x.type)).join(","), ptypes + JSON.stringify(plain.issues));
  const pm = plain.questions.find((p) => p.q.type === "MULTI")!.q;
  const om = all.find((x) => x.type === "MULTI")!;
  ok("…multi-response keeps its right options and penalty scoring", pm.answer.correct?.length === om.answer.correct?.length && pm.scoring.mode === om.scoring.mode, `${pm.scoring.mode} ${om.scoring.mode}`);
  const pc = plain.questions.find((p) => p.q.type === "CLOZE")!.q;
  ok("…cloze keeps drop-down right answers and typed answers", pc.content.blanks?.map((b) => b.kind).join() === "SELECT,TEXT" && pc.answer.blanks?.["2"]?.accepted?.[0] === "الإغلاق", JSON.stringify(pc.answer));

  const gx = exportAs("gift", all, "ar", {});
  const gback = await parseFile("gift", { text: gx.text }, "auto");
  ok("GIFT export skips types GIFT cannot hold (ordering, cloze, drag & drop, hotspot) and says so", gx.skipped.map((s) => s.type).sort().join() === "CLOZE,DRAGDROP,HOTSPOT,ORDERING", gx.skipped.map((s) => s.type).join());
  ok("GIFT round trip keeps type, stem and right answers", gback.questions.length === gx.exported && gback.questions.every((p, i) => { const o = all.filter((x) => !["ORDERING", "CLOZE", "DRAGDROP", "HOTSPOT"].includes(x.type))[i]; return p.q.type === o.type && T(p.q).replace(/\s+/g, " ") === T(o).replace(/\s+/g, " "); }) && !gback.issues.length, JSON.stringify(gback.issues));

  const cx = exportAs("csv", all, "ar", {});
  const cback = await parseFile("csv", { text: cx.text }, "auto");
  ok("CSV round trip: simple types kept, advanced ones skipped with a reason", cback.questions.length === cx.exported && cx.skipped.every((s) => ["MATCHING", "CLOZE", "DRAGDROP", "HOTSPOT"].includes(s.type)) && cback.questions.every((p, i) => p.q.type === all.filter((x) => !["MATCHING", "CLOZE", "DRAGDROP", "HOTSPOT"].includes(x.type))[i].type), JSON.stringify(cback.issues));

  const ax = exportAs("aiken", all, "ar", {});
  const aback = await parseFile("aiken", { text: ax.text }, "auto");
  ok("Aiken exports only single-answer multiple choice; round trip keeps the right option", aback.questions.length === ax.exported && ax.exported === all.filter((x) => x.type === "MCQ").length && !aback.issues.length, `${ax.exported} ${aback.questions.length}`);

  const jx = exportAs("json", all, "ar", { p1: "AAAA" });
  const jback = await parseFile("json", { text: jx.text }, "auto");
  ok("JSON round trip keeps every type including hotspot", jback.questions.length === all.length && jback.questions.every((p, i) => same(p.q, all[i])), "");

  // ── Excel (.xlsx) ──
  const xlsx = makeXlsx([["type", "stem_ar", "options_ar", "correct"], ["MCQ", "سؤال من إكسل", "أ|ب|ج", "C"], ["TRUE_FALSE", "عبارة", "", "FALSE"]]);
  r = await parseFile("xlsx", { buffer: xlsx }, "auto");
  ok("Excel file (shared strings, compressed parts) → questions", types(r.questions) === "MCQ,TRUE_FALSE" && r.questions[0].q.stemAr === "سؤال من إكسل" && r.questions[0].q.answer.correct?.[0] === r.questions[0].q.content.options?.[2].id, types(r.questions) + JSON.stringify(r.issues));
  r = await parseFile("xlsx", { buffer: new TextEncoder().encode("not a zip").buffer as ArrayBuffer }, "auto");
  ok("A file that is not Excel → one clear issue", r.issues[0]?.reason === "not_xlsx", JSON.stringify(r.issues));

  // ── safety ──
  const x = parseXml(`<?xml version="1.0"?><!DOCTYPE q [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><q>&xxe;&amp;</q>`);
  ok("XML: DOCTYPE/entities are never resolved (no external entity reading)", x.children[0].text === "&xxe;&", x.children[0].text);
  ok("HTML → text drops scripts and tags", htmlToText("<p>a<script>evil()</script><b>b</b></p>") === "ab", htmlToText("<p>a<script>evil()</script><b>b</b></p>"));
  const big = `<quiz>${"<question type='truefalse'><questiontext><text>x</text></questiontext><answer fraction='100'><text>true</text></answer></question>".repeat(600)}</quiz>`;
  r = await parseFile("moodle", { text: big }, "auto");
  ok("600 questions parse (the server then takes them in batches of 500)", r.questions.length === 600, String(r.questions.length));
}

/** minimal .xlsx: [Content_Types], workbook + rels, shared strings (deflated), sheet1 (stored) */
function makeXlsx(rows: string[][]): ArrayBuffer {
  const shared: string[] = [];
  const si = (s: string) => (shared.includes(s) ? shared.indexOf(s) : shared.push(s) - 1);
  const sheet = `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows
    .map((r, i) => `<row r="${i + 1}">${r.map((c, k) => (c === "" ? "" : `<c r="${String.fromCharCode(65 + k)}${i + 1}" t="s"><v>${si(c)}</v></c>`)).join("")}</row>`)
    .join("")}</sheetData></worksheet>`;
  const sst = `<?xml version="1.0"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${shared.map((s) => `<si><t>${s}</t></si>`).join("")}</sst>`;
  const files: [string, string, boolean][] = [
    ["[Content_Types].xml", "<Types/>", false],
    ["xl/workbook.xml", `<workbook xmlns:r="r"><sheets><sheet name="S" sheetId="1" r:id="rId1"/></sheets></workbook>`, false],
    ["xl/_rels/workbook.xml.rels", `<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>`, false],
    ["xl/sharedStrings.xml", sst, true],
    ["xl/worksheets/sheet1.xml", sheet, false],
  ];
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let off = 0;
  for (const [name, text, deflate] of files) {
    const raw = enc.encode(text);
    const data = deflate ? new Uint8Array(deflateRawSync(raw)) : raw;
    const nm = enc.encode(name);
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true);
    lh.setUint16(8, deflate ? 8 : 0, true);
    lh.setUint32(18, data.length, true);
    lh.setUint32(22, raw.length, true);
    lh.setUint16(26, nm.length, true);
    chunks.push(new Uint8Array(lh.buffer), nm, data);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true);
    ch.setUint16(10, deflate ? 8 : 0, true);
    ch.setUint32(20, data.length, true);
    ch.setUint32(24, raw.length, true);
    ch.setUint16(28, nm.length, true);
    ch.setUint32(42, off, true);
    central.push(new Uint8Array(ch.buffer), nm);
    off += 30 + nm.length + data.length;
  }
  const csize = central.reduce((n, c) => n + c.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, csize, true);
  end.setUint32(16, off, true);
  const all = [...chunks, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((n, c) => n + c.length, 0));
  let o = 0;
  for (const c of all) {
    out.set(c, o);
    o += c.length;
  }
  return out.buffer;
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
