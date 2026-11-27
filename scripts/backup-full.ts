/**
 * Full backup before a change (same as `npm run backup`, but no old backup is removed):
 *   npm run backup:full                          → backups/full-<timestamp>/ then tested
 *   npm run backup:full -- --check <folder|file> → test an existing backup again
 *   npm run backup:full -- --restore <folder|file> --yes   ⚠ replaces ALL data in the connected database
 */
import { PrismaClient } from "@prisma/client";
import { drill, restoreAll } from "../src/lib/full-backup";
import { runBackup } from "./lib/backup-run";

async function main() {
  const args = process.argv.slice(2);
  const after = (flag: string) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined);
  const db = new PrismaClient();
  try {
    const restore = after("--restore");
    if (args.includes("--restore")) {
      if (!restore) throw new Error("Usage: npm run backup:full -- --restore <folder> --yes");
      if (!args.includes("--yes")) {
        console.log("This REPLACES all data in the connected database. Make a fresh backup, then add --yes.");
        return;
      }
      const m = await restoreAll(db, restore);
      console.log(`✔ Restored ${m.order.length} tables from the backup of ${m.createdAt}`);
      return;
    }
    const check = after("--check");
    if (check) {
      const res = await drill(db, check);
      const bad = res.filter((r) => !r.ok);
      if (bad.length) throw new Error(`Restore test FAILED for: ${bad.map((r) => r.table).join(", ")}`);
      console.log(`✔ Restore test passed: ${res.length} tables loaded into temporary copies, all identical`);
      return;
    }
    const r = await runBackup(db, process.env);
    if (!r.filesOk) process.exitCode = 1;
  } finally {
    await db.$disconnect();
  }
}

main().catch((e) => {
  console.error("✗", e instanceof Error ? e.message : e);
  process.exit(1);
});
