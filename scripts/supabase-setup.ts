/**
 * One command to prepare the Supabase database:
 *   npm.cmd run supabase:setup
 * Needs DATABASE_URL in .env = the Supabase "Session pooler" connection string (you paste it there yourself).
 *  1. switches Prisma to PostgreSQL
 *  2. creates / updates the tables (prisma db push)
 *  3. adds the starting content + first admin if missing (never overwrites edits)
 *  4. applies the security rules in supabase/setup.sql
 * Safe to run again after schema changes.
 */
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const url = process.env.DATABASE_URL ?? "";
if (!/^postgres(ql)?:\/\//.test(url)) {
  console.error("✗ DATABASE_URL in .env must be the Supabase PostgreSQL connection string (postgresql://…). See docs/GITHUB-PAGES.md");
  process.exit(1);
}

const run = (cmd: string) => execSync(cmd, { stdio: "inherit", env: process.env });

const schemaFile = path.join(process.cwd(), "prisma/schema.prisma");
const schema = readFileSync(schemaFile, "utf8");
const pg = schema.replace(/(datasource db \{\s*provider\s*=\s*)"(sqlite|postgresql)"/, '$1"postgresql"');
if (pg !== schema) {
  writeFileSync(schemaFile, pg);
  console.log("✔ Prisma provider → postgresql");
}

// `npm run supabase:setup -- --sql-only` re-applies only the SQL files (functions, grants) — no schema push, no seed
if (!process.argv.includes("--sql-only")) {
  run("npx prisma generate");
  run("npx prisma db push --skip-generate");
  run("npx tsx --env-file-if-exists=.env prisma/seed.ts");
}

/** split SQL into statements, keeping $$ … $$ bodies together */
function statements(sql: string) {
  const out: string[] = [];
  let cur = "";
  let inDollar = false;
  for (const line of sql.split(/\r?\n/)) {
    if (line.trim().startsWith("--") && !inDollar) continue;
    cur += line + "\n";
    const n = (line.match(/\$\$/g) || []).length;
    if (n % 2 === 1) inDollar = !inDollar;
    if (!inDollar && line.trim().endsWith(";")) {
      if (cur.trim()) out.push(cur.trim());
      cur = "";
    }
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

async function main() {
  const { PrismaClient } = await import("@prisma/client");
  const db = new PrismaClient();
  // setup.sql first (locks everything), then the exam system (adds its own functions and grants)
  for (const file of ["supabase/setup.sql", "supabase/exams.sql", "supabase/exams-bank.sql", "supabase/exams-scenarios.sql", "supabase/exams-builder.sql"]) {
    const sql = readFileSync(path.join(process.cwd(), file), "utf8");
    for (const s of statements(sql)) await db.$executeRawUnsafe(s);
    console.log(`✔ Applied ${file}`);
  }
  await db.$disconnect();
  console.log("✔ Security rules applied (visitors can only submit forms; exam data only through checked functions)");
  console.log("\nDone. Next: add the GitHub secrets and run the Pages workflow — see docs/GITHUB-PAGES.md");
}

main().catch((e) => {
  console.error("✗", e instanceof Error ? e.message : e);
  process.exit(1);
});
