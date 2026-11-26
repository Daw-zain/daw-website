// Exam calculator engine tests — run: npx tsx scripts/test-calc.ts
import { evaluate, fmtNumber } from "../src/lib/exams/calc";

const cases: [string, number | null][] = [
  ["2+3", 5],
  ["2+3×4", 14],
  ["(2+3)×4", 20],
  ["10÷4", 2.5],
  ["7-10", -3],
  ["-5+2", -3],
  ["-(2+3)", -5],
  ["3×-2", -6],
  ["2^3^2", 512], // right-associative
  ["-2^2", -4],
  ["50%", 0.5],
  ["200×15%", 30],
  ["√(16)+1", 5],
  ["√16", 4],
  ["0.1+0.2", 0.3],
  ["1,5+1", 2.5],
  ["((1+2)×(3+4))÷7", 3],
  ["12.5×8", 100],
  ["1÷0", null],
  ["2+", null],
  ["(2+3", null],
  ["2+3)", null],
  ["1..2", null],
  ["abc", null],
  ["√(-4)", null],
  ["", null],
  ["alert(1)", null],
];
let failed = 0;
for (const [expr, expected] of cases) {
  const got = evaluate(expr);
  const shown = got === null ? null : Number(fmtNumber(got));
  const pass = expected === null ? got === null : shown === expected;
  if (!pass) failed++;
  console.log(`${pass ? "✔" : "✗"} ${expr || "(empty)"} = ${shown}${pass ? "" : `  ← expected ${expected}`}`);
}
console.log(`\n${cases.length - failed}/${cases.length} passed`);
if (failed) process.exitCode = 1;
