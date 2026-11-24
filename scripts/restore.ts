/**
 * Restore a backup created by `npm run backup` (or downloaded from Admin → Backup).
 *   npm run restore -- backups/2026-01-31-02-00-00
 *   npm run restore -- path/to/daw-site-backup.json
 * ⚠ This REPLACES all current data in the database. Make a fresh backup first.
 */
import { PrismaClient } from "@prisma/client";
import { cp, readFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { BACKUP_TABLES } from "../src/lib/backup";

const DATE_KEYS = /(At|Date)$/;

async function main() {
  const target = process.argv[2];
  if (!target) throw new Error("Usage: npm run restore -- <backup folder or .json file>");
  if (!process.argv.includes("--yes")) {
    console.log("This will REPLACE all data in the current database. Re-run with --yes to confirm:");
    console.log(`  npm run restore -- ${target} --yes`);
    return;
  }
  const isDir = (await stat(target)).isDirectory();
  const file = isDir ? path.join(target, "database.json") : target;
  const backup = JSON.parse(await readFile(file, "utf8"));
  if (backup.format !== "daw-site-backup") throw new Error("Not a Daw site backup file");

  const db = new PrismaClient();
  await db.$transaction(async (tx) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tm = (t: string) => (tx as any)[t];
    for (const t of [...BACKUP_TABLES].reverse()) await tm(t).deleteMany();
    for (const t of BACKUP_TABLES) {
      const rows = (backup.data[t] ?? []) as Record<string, unknown>[];
      for (const r of rows) {
        for (const [k, v] of Object.entries(r)) if (DATE_KEYS.test(k) && typeof v === "string") r[k] = new Date(v);
        if (t === "user" && !r.passwordHash) r.passwordHash = "!reset-required"; // JSON downloads exclude hashes
        await tm(t).create({ data: r });
      }
      console.log(`✔ ${t}: ${rows.length}`);
    }
  }, { timeout: 10 * 60 * 1000 });
  if (isDir && existsSync(path.join(target, "storage"))) {
    await cp(path.join(target, "storage"), path.join(process.cwd(), "storage"), { recursive: true });
    console.log("✔ storage/ files restored");
  }
  await db.$disconnect();
  if (!backup.includesPasswordHashes) console.log("! This backup had no password hashes: reset passwords with `npm run db:seed` (admin) or from the dashboard.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
