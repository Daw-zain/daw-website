// Phase 12 report files (CSV, .xlsx) and item-analysis flags. run: npx tsx scripts/test-exams-sheets.ts
import { writeFileSync } from "node:fs";
import { crc32, toCsv, toXlsx } from "../src/lib/exams/io/sheets";
import { parseCsvRows, readXlsx } from "../src/lib/exams/io/tabular";
import { pct, questionFlags } from "../src/lib/exams/analytics";

const results: { name: string; pass: boolean; info: string }[] = [];
const ok = (name: string, pass: boolean, info = "") => results.push({ name, pass, info });

const rows = [
  ["المتدرب", "Score", "Note"],
  ["أحمد, علي", 71.43, 'قال "نعم"\nسطر ثان'],
  ["=HYPERLINK(\"http://x\")", -5, "+1"],
  ["@cmd", 0, null],
];
const csv = toCsv(rows);
ok("CSV starts with a BOM so Excel reads Arabic", csv.charCodeAt(0) === 0xfeff);
const back = parseCsvRows(csv);
ok("CSV keeps commas, quotes, line breaks and Arabic", back[1][0] === "أحمد, علي" && back[1][2] === 'قال "نعم"\nسطر ثان' && back[1][1] === "71.43", JSON.stringify(back[1]));
ok("Formula-like text is neutralised in CSV", back[2][0].startsWith("'=") && back[2][2] === "'+1" && back[3][0] === "'@cmd", JSON.stringify([back[2], back[3]]));
ok("…but negative numbers stay numbers", back[2][1] === "-5", back[2][1]);

ok("CRC-32 of '123456789' is the standard check value", crc32(new TextEncoder().encode("123456789")) === 0xcbf43926);

const bytes = toXlsx(
  [
    { name: "نظرة عامة", rows },
    { name: "a/b:c*d?e[f]\\g and a very long name that goes past the limit", rows: [["x"], [1]] },
    { name: "نظرة عامة", rows: [["y"]] },
  ],
  true,
);
const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
(async () => {
  const read = await readXlsx(buf);
  ok("xlsx: the first sheet reads back cell by cell", read[1][0] === "أحمد, علي" && read[1][1] === "71.43" && read[2][0] === '=HYPERLINK("http://x")' && read[2][1] === "-5" && read[0][2] === "Note", JSON.stringify(read));
  const text = new TextDecoder().decode(bytes);
  const names = [...text.matchAll(/<sheet name="([^"]*)"/g)].map((m) => m[1]);
  ok("xlsx: sheet names are legal (≤31, no reserved characters) and unique", names.length === 3 && names.every((n) => n.length <= 31 && !/[[\]:*?/\\]/.test(n)) && new Set(names).size === 3, JSON.stringify(names));
  ok("xlsx: numbers are stored as numbers, text as inline strings, no formulas", text.includes("<v>71.43</v>") && !text.includes("<f>") && text.includes('t="inlineStr"'));
  ok("xlsx: right-to-left sheet for Arabic", text.includes('rightToLeft="1"'));
  const dirty = toXlsx([{ name: "s", rows: [["a\u0001b<&>"]] }]);
  const d = await readXlsx(dirty.buffer.slice(dirty.byteOffset, dirty.byteOffset + dirty.byteLength) as ArrayBuffer);
  ok("xlsx: control characters removed, markup escaped", d[0][0] === "ab<&>", JSON.stringify(d));
  // a copy for checking with another zip reader: npx tsx scripts/test-exams-sheets.ts <out.xlsx>
  if (process.argv[2]) writeFileSync(process.argv[2], bytes);

  const f = (asked: number, facility: number | null, discrimination: number | null) => questionFlags({ asked, facility, discrimination }).join(",");
  ok("Flags: hard and easy need 5 answers", f(5, 39.9, null) === "hard" && f(5, 90.1, null) === "easy" && f(4, 0, null) === "" && f(5, 40, null) === "" && f(5, 90, null) === "");
  ok("Flags: weak and negative discrimination", f(10, 60, 0.1) === "weak" && f(10, 60, -0.2) === "negative" && f(10, 60, 0.15) === "" && f(10, 20, -0.5) === "hard,negative");
  ok("Percent formatting: null shows a dash, never zero", pct(null) === "—" && pct(0) === "0%" && pct(43.75) === "43.8%");

  for (const r of results) console.log(`${r.pass ? "✔" : "✘"} ${r.name}${r.pass ? "" : `  → ${r.info}`}`);
  const passed = results.filter((r) => r.pass).length;
  console.log(`\n${passed}/${results.length} passed`);
  process.exit(passed === results.length ? 0 : 1);
})();
