
/** What `npm run backup` and `npm run backup:full` do: database + restore drill, then files and Auth users. */
import type { PrismaClient } from "@prisma/client";
import { createClient } from "@supabase/supabase-js";
import { existsSync } from "node:fs";
import { cp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { drill, dumpAll } from "../../src/lib/full-backup";
import { mirrorStorage, projectUrl } from "./storage-mirror";

const FOLDER = /^full-\d{4}-\d\d-\d\d-\d\d-\d\d-\d\d$/;

/** Written last, only when the database, the online files and the account list were all saved. */
const COMPLETE = "complete.json";

/**
 * Removes the oldest complete backups beyond `keep`. A backup without the `complete.json` mark
 * (incomplete, interrupted, or made before the mark existed) is neither counted nor removed.
 */
export async function prune(root: string, keep: number): Promise<string[]> {
  const ours: string[] = [];

  for (const name of await readdir(root).catch(() => [] as string[])) {
    if (!FOLDER.test(name)) continue;

    const manifest = await readFile(
      path.join(root, name, "manifest.json"),
      "utf8"
    ).catch(() => "");

    if (manifest.includes('"daw-full-backup"') && existsSync(path.join(root, name, COMPLETE))) {
      ours.push(name);
    }
  }

  const old = ours
    .sort()
    .slice(0, Math.max(0, ours.length - Math.max(1, keep)));

  for (const name of old) {
    await rm(path.join(root, name), { recursive: true, force: true });
  }

  return old;
}

/** Exports safe account details only. Passwords, tokens and MFA secrets are excluded. */
async function exportAuthUsers(
  url: string,
  key: string,
  dir: string
): Promise<number> {
  const supabase = createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  const users: Record<string, unknown>[] = [];
  const perPage = 1000;
  let page = 1;

  while (true) {
    const { data, error } = await supabase.auth.admin.listUsers({
      page,
      perPage,
    });

    if (error) {
      throw new Error(`Supabase Auth export failed on page ${page}: ${error.message}`);
    }

    const batch = data.users.map((user) => ({
      id: user.id,
      aud: user.aud,
      role: user.role,
      email: user.email,
      phone: user.phone,
      created_at: user.created_at,
      updated_at: user.updated_at,
      last_sign_in_at: user.last_sign_in_at,
      email_confirmed_at: user.email_confirmed_at,
      phone_confirmed_at: user.phone_confirmed_at,
      confirmed_at: user.confirmed_at,
      banned_until: user.banned_until,
      is_anonymous: user.is_anonymous,
      app_metadata: user.app_metadata,
      user_metadata: user.user_metadata,
    }));

    users.push(...batch);

    if (batch.length < perPage) break;
    page++;
  }

  const snapshot = {
    backup_type: "daw-supabase-auth-users",
    exported_at: new Date().toISOString(),
    count: users.length,
    users,
  };

  await writeFile(
    path.join(dir, "auth-users.json"),
    JSON.stringify(snapshot, null, 2),
    "utf8"
  );

  return users.length;
}

export async function runBackup(
  db: PrismaClient,
  env: Record<string, string | undefined>,
  log: (line: string) => void = console.log
) {
  const root = path.resolve(
    env.BACKUP_DIR || path.join(process.cwd(), "backups")
  );

  const dir = path.join(
    root,
    `full-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}`
  );

  const m = await dumpAll(db, dir);
  const rows = Object.values(m.tables).reduce((n, t) => n + t.rows, 0);

  log(`✔ Database written to ${dir} (${m.order.length} tables, ${rows} rows)`);

  const res = await drill(db, dir);
  const bad = res.filter((r) => !r.ok);

  if (bad.length) {
    throw new Error(
      `Restore test FAILED for: ${bad.map((r) => r.table).join(", ")}`
    );
  }

  log(`✔ Restore test passed: ${res.length} tables loaded into temporary copies, all identical`);

  // Copy local website uploads.
  const local = path.join(process.cwd(), "storage");

  if (existsSync(local)) {
    await cp(local, path.join(dir, "storage"), { recursive: true });
    log("✔ Local storage/ folder copied");
  }

  let filesOk = true;

  const key =
    env.SUPABASE_SERVICE_ROLE_KEY ||
    env.SUPABASE_SECRET_KEY;

  const url = projectUrl(env);

  if (!key || !url) {
    filesOk = false;
    log("✗ Online storage and Supabase Auth were NOT backed up: service role key or project URL is missing.");
  } else {
    // Mirror online Storage files.
    const files = await mirrorStorage({
      url,
      key,
      dir: path.join(root, "files"),
      log,
    });

    await writeFile(
      path.join(dir, "files.json"),
      JSON.stringify(files.files, null, 2),
      "utf8"
    );

    log(
      `${files.failed.length ? "✗" : "✔"} Online files: ${files.files.length} listed, ${files.copied} copied now, ${files.present} already here, ${files.failed.length} failed`
    );

    for (const f of files.failed) {
      log(`  ✗ ${f.file}: ${f.reason}`);
    }

    if (files.failed.length > 0) filesOk = false;

    // Export Supabase Auth account records.
    try {
      const count = await exportAuthUsers(url, key, dir);
      log(`✔ Supabase Auth: ${count} account records exported to auth-users.json`);
    } catch (error) {
      filesOk = false;
      log(
        `✗ Supabase Auth export failed: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  log("! Auth export excludes passwords, sessions, access/refresh tokens and MFA secrets.");

  if (filesOk) {
    await writeFile(
      path.join(dir, COMPLETE),
      JSON.stringify({ completedAt: new Date().toISOString() }),
      "utf8"
    );
  }

  return {
    root,
    dir,
    filesOk,
    filesIncluded: !!(key && url),
  };
}
