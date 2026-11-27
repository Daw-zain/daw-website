
/**
 * Full backup:
 * - Database backup and restore test
 * - Local and online storage files
 * - Supabase Auth account records
 * Keeps the latest 30 successful backups by default.
 */
import { PrismaClient } from "@prisma/client";
import { prune, runBackup } from "./lib/backup-run";

async function main() {
  const db = new PrismaClient();

  try {
    console.log(`— ${new Date().toISOString()} —`);

    const r = await runBackup(db, process.env);

    if (!r.filesOk) {
      throw new Error(
        "Backup is incomplete. Old backups have been preserved; no pruning was performed."
      );
    }

    const keep = Math.max(
      1,
      Number(process.env.BACKUP_KEEP || 30)
    );

    const removed = await prune(r.root, keep);

    console.log("✔ Backup completed successfully.");
    console.log(`✔ Retention policy: latest ${keep} successful backups.`);

    if (removed.length) {
      console.log(`✔ Removed ${removed.length} old backup(s).`);
    }
  } finally {
    await db.$disconnect();
  }
}

main().catch((e) => {
  console.error("✗", e instanceof Error ? e.message : e);
  process.exit(1);
});
