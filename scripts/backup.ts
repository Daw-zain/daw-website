/**
 * The regular backup (every database table with a restore test, plus the files):
 *   npm run backup            → backups/full-<timestamp>/  and  backups/files/
 * Keeps the latest 30 database backups (BACKUP_KEEP). BACKUP_DIR chooses another place, for example an
 * external disk. Schedule it daily with scripts/schedule-backup.ps1 (Windows) – see docs/OPERATIONS.md.
 */
import { PrismaClient } from "@prisma/client";
import { prune, runBackup } from "./lib/backup-run";

async function main() {
  const db = new PrismaClient();
  try {
    console.log(`— ${new Date().toISOString()} —`);
    const r = await runBackup(db, process.env);
    const removed = await prune(r.root, Number(process.env.BACKUP_KEEP || 30));
    if (removed.length) console.log(`✔ Removed ${removed.length} old backup(s)`);
    if (!r.filesOk) process.exitCode = 1;
  } finally {
    await db.$disconnect();
  }
}

main().catch((e) => {
  console.error("✗", e instanceof Error ? e.message : e);
  process.exit(1);
});
