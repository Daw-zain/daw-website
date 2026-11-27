/**
 * Full database backup (every table) with a restore drill.
 *   npm run backup:full                          → backups/full-<timestamp>/ then tested
 *   npm run backup:full -- --check <folder>      → test an existing backup again
 *   npm run backup:full -- --restore <folder> --yes   ⚠ replaces ALL data in the connected database
 */
import { PrismaClient } from "@prisma/client";
import path from "node:path";
import { drill, dumpAll, restoreAll } from "./lib/full-backup";

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
    let dir = after("--check");
    if (!dir) {
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
      dir = path.join(process.cwd(), "backups", `full-${stamp}`);
      const m = await dumpAll(db, dir);
      const rows = Object.values(m.tables).reduce((n, t) => n + t.rows, 0);
      console.log(`✔ Backup written to ${dir} (${m.order.length} tables, ${rows} rows)`);
    }
    const res = await drill(db, dir);
    const bad = res.filter((r) => !r.ok);
    if (bad.length) throw new Error(`Restore test FAILED for: ${bad.map((r) => r.table).join(", ")}`);
    console.log(`✔ Restore test passed: ${res.length} tables loaded into temporary copies, all identical`);
    console.log("! Not included: Supabase sign-in accounts and uploaded files in Supabase Storage.");
  } finally {
    await db.$disconnect();
  }
}

main().catch((e) => {
  console.error("✗", e instanceof Error ? e.message : e);
  process.exit(1);
});
