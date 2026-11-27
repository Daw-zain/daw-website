// LMS-2: reading trainee files and subscription dates. run: npx tsx scripts/test-lms-files.ts
import { peopleTemplate, rowsToPeople } from "../src/lib/exams/io/people";
import { parseCsvRows, readXlsx } from "../src/lib/exams/io/tabular";
import { toCsv, toXlsx } from "../src/lib/exams/io/sheets";
import { fromUtcDay, untilDay } from "../src/lib/exams/days";

const results: { name: string; pass: boolean; info: string }[] = [];
const ok = (name: string, pass: boolean, info: unknown = "") => results.push({ name, pass, info: JSON.stringify(info) });

async function main() {
  for (const locale of ["ar", "en"]) {
    const t = peopleTemplate(locale, "PMP");
    const csv = rowsToPeople(parseCsvRows(toCsv(t)));
    const bytes = toXlsx([{ name: "t", rows: t }], locale === "ar");
    const xlsx = rowsToPeople(await readXlsx(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer));
    for (const [kind, r] of [["CSV", csv], ["Excel", xlsx]] as const) {
      const p = r.rows[0];
      ok(`${locale} ${kind} template reads back: every column recognised`, r.error === null && r.rows.length === 1 && !!p.name && p.email.includes("@") && p.phone === "0910000000" && !!p.organization && !!p.jobTitle && !!p.city && p.course === "PMP", r);
    }
  }
  const mixed = rowsToPeople([["البريد", "ملاحظة", "  الاسم الكامل ", "COURSE"], ["a@x.ly", "تُهمل", "أحمد", "pmp"], ["", "", "", ""], ["b@x.ly", "", "سالم", ""]]);
  ok("Columns in any order and either language; extra columns and empty rows ignored", mixed.error === null && mixed.rows.length === 2 && mixed.rows[0].name === "أحمد" && mixed.rows[0].course === "pmp" && mixed.rows[1].phone === "", mixed);
  ok("A file with only headers is empty", rowsToPeople([["name", "email"]]).error === "empty");
  ok("Missing e-mail column is reported", rowsToPeople([["name"], ["x"]]).error === "no_email_column");
  ok("Missing name column is reported", rowsToPeople([["email"], ["x@x.ly"]]).error === "no_name_column");
  const many = (n: number) => rowsToPeople([["name", "email"], ...Array.from({ length: n }, (_, i) => [`n${i}`, `e${i}@x.ly`])]);
  ok("500 rows accepted, 501 refused", many(500).rows.length === 500 && many(501).error === "max_500");
  const semi = rowsToPeople(parseCsvRows("name;email\nعلي;ali@x.ly\n"));
  ok("Semicolon-separated CSV (Excel in some regions) is read", semi.error === null && semi.rows[0]?.email === "ali@x.ly", semi);

  // the database stores: start = local midnight, end = the following local midnight, both in UTC
  ok("Start date shows the chosen day", fromUtcDay("2026-11-30T22:00:00") === "2026-12-01", fromUtcDay("2026-11-30T22:00:00"));
  ok("End date shows the last valid day, not the next one", untilDay("2026-12-31T22:00:00") === "2026-12-31", untilDay("2026-12-31T22:00:00"));
  ok("Empty dates stay empty", untilDay(null) === "" && fromUtcDay(undefined) === "");

  for (const r of results) console.log(`${r.pass ? "✔" : "✘"} ${r.name}${r.pass ? "" : `  → ${r.info.slice(0, 300)}`}`);
  const passed = results.filter((r) => r.pass).length;
  console.log(`\n${passed}/${results.length} passed`);
  process.exit(passed === results.length ? 0 : 1);
}
main();
