/**
 * ⚠ Restore a backup. REPLACES all current data in the database. Make a fresh backup first.
 *   npm run restore -- backups/full-2026-01-31-02-00-00 --yes      (a backup folder)
 *   npm run restore -- path/to/daw-site-full-backup.json --yes     (downloaded from the dashboard)
 * Older backups that hold the website tables only are accepted only into a database without platform data,
 * because replacing the courses would delete everything that belongs to them.
 */
import { PrismaClient } from "@prisma/client";
import { cp, readFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { restoreAll } from "../src/lib/full-backup";
import { platformData, restoreWebsiteOnly, WEBSITE_ONLY_FORMAT } from "./lib/restore-website";

async function main() {
  const target = process.argv[2];
  if (!target) throw new Error("Usage: npm run restore -- <backup folder or .json file> --yes");
  if (!process.argv.includes("--yes")) {
    console.log("This will REPLACE all data in the current database. Re-run with --yes to confirm:");
    console.log(`  npm run restore -- ${target} --yes`);
    return;
  }
  const isDir = (await stat(target)).isDirectory();
  // a folder of the old `npm run backup` keeps the full copy in its "full" sub-folder
  const full = isDir ? [target, path.join(target, "full")].find((d) => existsSync(path.join(d, "manifest.json"))) : undefined;
  const single = !isDir ? JSON.parse(await readFile(target, "utf8")) : undefined;

  const db = new PrismaClient();
  try {
    if (full || single?.format === "daw-full-backup") {
      const m = await restoreAll(db, full ?? target);
      console.log(`✔ Restored ${m.order.length} tables from the backup of ${m.createdAt}`);
      if (single && single.passwordHashes === false) console.log("! This backup has no password hashes: reset the dashboard passwords with `npm run admin:reset-password`.");
    } else {
      const backup = single ?? JSON.parse(await readFile(path.join(target, "database.json"), "utf8"));
      if (backup.format !== WEBSITE_ONLY_FORMAT) throw new Error("Not a Daw site backup");
      const found = await platformData(db);
      if (found.length) throw new Error(`Refused: this backup holds the website tables only, and the database has platform data (${found.join(", ")}) that it would delete. Use a full backup.`);
      await restoreWebsiteOnly(db, backup, console.log);
    }
    if (isDir && existsSync(path.join(target, "storage"))) {
      await cp(path.join(target, "storage"), path.join(process.cwd(), "storage"), { recursive: true });
      console.log("✔ storage/ files restored");
    }
  } finally {
    await db.$disconnect();
  }
}

main().catch((e) => {
  console.error("✗", e instanceof Error ? e.message : e);
  process.exit(1);
});
