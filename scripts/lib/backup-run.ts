/** What `npm run backup` and `npm run backup:full` do: database + restore drill, then the files. */
import type { PrismaClient } from "@prisma/client";
import { existsSync } from "node:fs";
import { cp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { drill, dumpAll } from "../../src/lib/full-backup";
import { mirrorStorage, projectUrl } from "./storage-mirror";

const FOLDER = /^full-\d{4}-\d\d-\d\d-\d\d-\d\d-\d\d$/;

/** removes the oldest complete backups beyond `keep`; anything else in the folder is left alone */
export async function prune(root: string, keep: number): Promise<string[]> {
  const ours: string[] = [];
  for (const name of await readdir(root).catch(() => [] as string[])) {
    if (!FOLDER.test(name)) continue;
    const manifest = await readFile(path.join(root, name, "manifest.json"), "utf8").catch(() => "");
    if (manifest.includes('"daw-full-backup"')) ours.push(name);
  }
  const old = ours.sort().slice(0, Math.max(0, ours.length - Math.max(1, keep)));
  for (const name of old) await rm(path.join(root, name), { recursive: true, force: true });
  return old;
}

export async function runBackup(db: PrismaClient, env: Record<string, string | undefined>, log: (line: string) => void = console.log) {
  const root = path.resolve(env.BACKUP_DIR || path.join(process.cwd(), "backups"));
  const dir = path.join(root, `full-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}`);

  const m = await dumpAll(db, dir);
  const rows = Object.values(m.tables).reduce((n, t) => n + t.rows, 0);
  log(`✔ Database written to ${dir} (${m.order.length} tables, ${rows} rows)`);
  const res = await drill(db, dir);
  const bad = res.filter((r) => !r.ok);
  if (bad.length) throw new Error(`Restore test FAILED for: ${bad.map((r) => r.table).join(", ")}`);
  log(`✔ Restore test passed: ${res.length} tables loaded into temporary copies, all identical`);

  // files uploaded through the website dashboard on this computer
  const local = path.join(process.cwd(), "storage");
  if (existsSync(local)) {
    await cp(local, path.join(dir, "storage"), { recursive: true });
    log("✔ Local storage/ folder copied");
  }

  let filesOk = true;
  const key = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
  const url = projectUrl(env);
  if (!key || !url) {
    log("! Files uploaded to the online platform were NOT backed up: add SUPABASE_SECRET_KEY to .env (docs/OPERATIONS.md).");
  } else {
    const files = await mirrorStorage({ url, key, dir: path.join(root, "files"), log });
    await writeFile(path.join(dir, "files.json"), JSON.stringify(files.files, null, 2), "utf8");
    log(`${files.failed.length ? "✗" : "✔"} Online files: ${files.files.length} listed, ${files.copied} copied now, ${files.present} already here, ${files.failed.length} failed (folder ${path.join(root, "files")})`);
    for (const f of files.failed) log(`  ✗ ${f.file}: ${f.reason}`);
    filesOk = files.failed.length === 0;
  }
  log("! Not included: Supabase sign-in accounts.");
  return { root, dir, filesOk, filesIncluded: !!(key && url) };
}
