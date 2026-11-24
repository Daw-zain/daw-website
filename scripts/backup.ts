/**
 * Full backup: database (JSON, including password hashes) + uploaded files.
 *   npm run backup            → backups/<timestamp>/
 * Schedule it daily with cron (Linux) or Task Scheduler (Windows) – see docs/OPERATIONS.md.
 * Keeps the 30 most recent backups.
 */
import { PrismaClient } from "@prisma/client";
import { cp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { buildBackup } from "../src/lib/backup";

const KEEP = Number(process.env.BACKUP_KEEP || 30);

async function main() {
  const db = new PrismaClient();
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  const root = path.join(process.cwd(), "backups");
  const dir = path.join(root, stamp);
  await mkdir(dir, { recursive: true });

  const data = await buildBackup(db, { includePasswordHashes: true });
  await writeFile(path.join(dir, "database.json"), JSON.stringify(data));
  const storage = path.join(process.cwd(), "storage");
  if (existsSync(storage)) await cp(storage, path.join(dir, "storage"), { recursive: true });
  await db.$disconnect();
  console.log(`✔ Backup written to ${dir}`);

  const all = (await readdir(root)).sort();
  for (const old of all.slice(0, Math.max(0, all.length - KEEP))) await rm(path.join(root, old), { recursive: true, force: true });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
