/**
 * Phase 0 — protecting what exists. run: npx tsx --env-file=.env scripts/test-phase0.ts
 * The course guard runs in a rolled-back transaction; backups go to a temporary folder that is removed;
 * the storage service is replaced by a small local one, so no real key is needed.
 */
import { PrismaClient } from "@prisma/client";
import { createServer } from "node:http";
import { mkdtemp, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { courseDependents } from "../src/lib/course-guard";
import { drill, exportBundle, loadBackup, NO_PASSWORD } from "../src/lib/full-backup";
import { prune, runBackup } from "./lib/backup-run";
import { localPath, mirrorStorage, projectUrl } from "./lib/storage-mirror";
import { platformData } from "./lib/restore-website";

const db = new PrismaClient();
const results: { name: string; pass: boolean; info: string }[] = [];
const ok = (name: string, pass: unknown, info: unknown = "") => results.push({ name, pass: !!pass, info: JSON.stringify(info) });
const ROLLBACK = new Error("rollback");

async function courseGuard() {
  const before = await db.program.count();
  try {
    await db.$transaction(async (tx) => {
      const withData = await tx.program.findFirstOrThrow({ where: { questions: { some: {} } } });
      const held = await courseDependents(tx, withData.id);
      ok("A course with questions is reported as holding them", held.some((h) => h.key === "questions" && h.count > 0), held);
      const empty = await tx.program.create({ data: { slug: "phase0-empty", titleAr: "فارغة", titleEn: "Empty", summaryAr: "", summaryEn: "", descriptionAr: "", descriptionEn: "", published: false } });
      const folders = await tx.examFolder.count({ where: { programId: empty.id } });
      ok("A new course (with only its automatic folders) may be deleted", folders === 5 && (await courseDependents(tx, empty.id)).length === 0, folders);
      const member = await tx.examMember.findFirstOrThrow();
      const cases: [string, () => Promise<unknown>, () => Promise<unknown>][] = [
        ["registrations", () => tx.registration.create({ data: { id: "p0-r", programId: empty.id, fullName: "x", email: "x@x.test", phone: "1", locale: "ar" } }), () => tx.registration.delete({ where: { id: "p0-r" } })],
        ["enrollments", () => tx.enrollment.create({ data: { id: "p0-e", programId: empty.id, memberId: member.id } }), () => tx.enrollment.delete({ where: { id: "p0-e" } })],
        ["content", () => tx.courseItem.create({ data: { id: "p0-i", programId: empty.id, section: "MATERIAL", source: "LINK", titleAr: "x", url: "https://example.org" } }), () => tx.courseItem.delete({ where: { id: "p0-i" } })],
        ["folders", () => tx.courseFolder.create({ data: { id: "p0-f", programId: empty.id, section: "VIDEO", nameAr: "x" } }), () => tx.courseFolder.delete({ where: { id: "p0-f" } })],
        ["sessions", () => tx.courseSession.create({ data: { id: "p0-s", programId: empty.id, startDate: new Date() } }), () => tx.courseSession.delete({ where: { id: "p0-s" } })],
        ["trainers", () => tx.courseInstructor.create({ data: { id: "p0-t", programId: empty.id, memberId: member.id } }), () => tx.courseInstructor.delete({ where: { id: "p0-t" } })],
        ["categories", () => tx.questionCategory.create({ data: { id: "p0-c", programId: empty.id, kind: "DOMAIN", nameAr: "x" } }), () => tx.questionCategory.delete({ where: { id: "p0-c" } })],
      ];
      for (const [key, add, remove] of cases) {
        await add();
        const found = await courseDependents(tx, empty.id);
        ok(`One of "${key}" is enough to refuse deletion`, found.length === 1 && found[0].key === key && found[0].count === 1, found);
        await remove();
      }
      throw ROLLBACK;
    }, { timeout: 120000, maxWait: 30000 });
  } catch (e) {
    if (e !== ROLLBACK) throw e;
  }
  ok("The guard test left no course behind", (await db.program.count()) === before);
  const action = readFileSync("src/app/admin/actions.ts", "utf8");
  ok("The dashboard checks inside the same transaction that deletes", /courseDependents\(tx, id\)\)\.length\) return false;\s+await tx\.program\.delete/.test(action));
}

async function backups() {
  const root = await mkdtemp(path.join(tmpdir(), "daw-p0-"));
  try {
    const tables = (await db.$queryRawUnsafe<{ n: number }[]>(`select count(*)::int n from pg_tables where schemaname = 'public'`))[0].n;
    const lines: string[] = [];
    const run = await runBackup(db, { BACKUP_DIR: root, DATABASE_URL: process.env.DATABASE_URL }, (l) => lines.push(l));
    ok("The backup holds every table and passes its restore test", lines.some((l) => l.includes(`${tables} tables`)) && lines.some((l) => l.includes(`Restore test passed: ${tables} tables`)), lines);
    ok("Without the secret key it says the online files were not included", !run.filesIncluded && lines.some((l) => l.includes("NOT backed up")), lines);
    const loaded = await loadBackup(run.dir);
    ok("Platform tables are in it", ["Question", "QuestionSecret", "ExamAttempt", "Enrollment", "CourseItem", "ExamMember"].every((t) => loaded.manifest.tables[t]?.rows > 0), Object.keys(loaded.manifest.tables).length);

    // the dashboard download
    const bundle = await exportBundle(db, { passwordHashes: false });
    const users = JSON.parse(bundle.data.User) as { passwordHash: string }[];
    ok("The download has every table", bundle.order.length === tables && Object.keys(bundle.data).length === tables, bundle.order.length);
    ok("The download has no password hashes", users.length > 0 && users.every((u) => u.passwordHash === NO_PASSWORD) && !/\$2[aby]\$\d\d\$/.test(JSON.stringify(bundle)), users.length);
    const live = await db.user.findFirst();
    ok("The accounts themselves keep their passwords", !!live && live.passwordHash.startsWith("$2"));
    const file = path.join(root, "download.json");
    await writeFile(file, JSON.stringify(bundle));
    const res = await drill(db, file);
    ok("The downloaded file passes a restore test", res.length === tables && res.every((r) => r.ok), res.filter((r) => !r.ok));
    const broken = path.join(root, "broken.json");
    await writeFile(broken, JSON.stringify({ ...bundle, data: { ...bundle.data, Program: "[]" } }));
    ok("An altered file is refused", await loadBackup(broken).then(() => false, (e) => /changed or damaged/.test(e.message)));

    const found = await platformData(db);
    ok("An old website-only backup would be refused here", found.length > 0, found);

    // pruning removes only complete backups of ours, oldest first
    const p = path.join(root, "prune");
    for (const [name, manifest] of [["full-2026-01-01-00-00-00", true], ["full-2026-01-02-00-00-00", true], ["full-2026-01-03-00-00-00", true], ["full-2025-01-01-00-00-00", false], ["2026-01-01-00-00-00", true], ["files", false], ["my photos", false]] as const) {
      await mkdir(path.join(p, name), { recursive: true });
      if (manifest) await writeFile(path.join(p, name, "manifest.json"), JSON.stringify({ format: "daw-full-backup" }));
    }
    const removed = await prune(p, 2);
    const left = (await readdir(p)).sort();
    ok("Only the oldest complete backup beyond the limit is removed", JSON.stringify(removed) === JSON.stringify(["full-2026-01-01-00-00-00"]) && left.length === 6 && left.includes("files") && left.includes("my photos") && left.includes("full-2025-01-01-00-00-00"), { removed, left });
    ok("The newest backup is never removed", (await prune(p, 0)).length === 1 && (await readdir(p)).includes("full-2026-01-03-00-00-00"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function files() {
  const dir = await mkdtemp(path.join(tmpdir(), "daw-p0f-"));
  const store: Record<string, Record<string, string>> = {
    "course-files": { "p1/a.pdf": "alpha", "p1/deep/b.mp4": "bravo-bravo", "p2/ملف عربي.pdf": "عربي", ...Object.fromEntries(Array.from({ length: 130 }, (_, i) => [`many/f${String(i).padStart(3, "0")}.txt`, `n${i}`])) },
    "member-files": { "m/photo.png": "png" },
    "course-covers": {},
  };
  let downloads = 0;
  let broken = "";
  const server = createServer((req, res) => {
    if (req.headers.apikey !== "test-key" || req.headers.authorization !== "Bearer test-key") { res.statusCode = 401; return res.end(); }
    const url = decodeURIComponent(req.url ?? "");
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      if (url === "/storage/v1/bucket") return res.end(JSON.stringify(Object.keys(store).map((id) => ({ id }))));
      const list = url.match(/^\/storage\/v1\/object\/list\/(.+)$/);
      if (list) {
        const { prefix, limit, offset } = JSON.parse(body);
        const under = Object.entries(store[list[1]]).filter(([n]) => !prefix || n.startsWith(`${prefix}/`)).map(([n, v]) => [prefix ? n.slice(prefix.length + 1) : n, v] as const);
        const entries = new Map<string, { name: string; id: string | null; metadata: { size: number } | null }>();
        for (const [rest, v] of under) {
          const [head, ...tail] = rest.split("/");
          entries.set(head, tail.length ? { name: head, id: null, metadata: null } : { name: head, id: head, metadata: { size: Buffer.byteLength(v) } });
        }
        return res.end(JSON.stringify([...entries.values()].sort((a, b) => a.name.localeCompare(b.name)).slice(offset, offset + limit)));
      }
      const get = url.match(/^\/storage\/v1\/object\/([^/]+)\/(.+)$/);
      const value = get ? store[get[1]]?.[get[2]] : undefined;
      if (value === undefined) { res.statusCode = 404; return res.end(); }
      downloads++;
      res.end(get![2] === broken ? value.slice(1) : value);
    });
  });
  await new Promise<void>((r) => server.listen(0, r));
  const url = `http://localhost:${(server.address() as { port: number }).port}`;
  try {
    const first = await mirrorStorage({ url, key: "test-key", dir });
    ok("Every file of every bucket is copied, through folders and pages", first.files.length === 134 && first.copied === 134 && first.failed.length === 0, { n: first.files.length, copied: first.copied, failed: first.failed.slice(0, 3) });
    ok("Contents are exact, Arabic names included", (await readFile(path.join(dir, "course-files", "p2", "ملف عربي.pdf"), "utf8")) === "عربي" && (await readFile(path.join(dir, "course-files", "p1", "deep", "b.mp4"), "utf8")) === "bravo-bravo");
    downloads = 0;
    delete store["course-files"]["p1/a.pdf"];
    store["course-files"]["p1/new.pdf"] = "new";
    const second = await mirrorStorage({ url, key: "test-key", dir });
    ok("A second run copies only what is new", downloads === 1 && second.copied === 1 && second.present === 133, { downloads, second: [second.copied, second.present] });
    ok("A file deleted online stays in the backup", existsSync(path.join(dir, "course-files", "p1", "a.pdf")));
    store["member-files"]["m/photo.png"] = "bigger-png";
    broken = "m/photo.png";
    const third = await mirrorStorage({ url, key: "test-key", dir });
    ok("An incomplete download is reported and the earlier copy is kept", third.failed.length === 1 && /received 9 of 10/.test(third.failed[0].reason) && (await readFile(path.join(dir, "member-files", "m", "photo.png"), "utf8")) === "png" && !existsSync(path.join(dir, "member-files", "m", "photo.png.part")), third.failed);
    ok("A wrong key is refused", await mirrorStorage({ url, key: "wrong", dir }).then(() => false, (e) => /401/.test(e.message)));
    ok("Names cannot leave the backup folder", ["../x", "a/../../x", "a//b", "/etc/passwd", "a\\..\\x", "C:/x", "con", "a/nul.txt", "x."].every((n) => localPath(dir, "b", n) === null) && localPath(dir, "..", "x") === null);
    store["course-covers"]["../escape.txt"] = "x";
    const fourth = await mirrorStorage({ url, key: "test-key", dir });
    ok("A dangerous name is reported, not written", fourth.failed.some((f) => f.reason === "unsafe name") && !existsSync(path.join(dir, "escape.txt")), fourth.failed);
    const run = await (async () => {
      const root = path.join(dir, "run");
      const lines: string[] = [];
      broken = "";
      delete store["course-covers"]["../escape.txt"];
      const r = await runBackup(db, { BACKUP_DIR: root, SUPABASE_SECRET_KEY: "test-key", SUPABASE_URL: url, DATABASE_URL: process.env.DATABASE_URL }, (l) => lines.push(l));
      return { r, lines, listed: JSON.parse(await readFile(path.join(r.dir, "files.json"), "utf8")) as unknown[], size: (await stat(path.join(root, "files", "course-files", "p1", "new.pdf"))).size };
    })();
    ok("With the key one command backs up database and files", run.r.filesIncluded && run.r.filesOk && run.listed.length === 134 && run.size === 3, run.lines);
    ok("The key is never printed", !run.lines.join("\n").includes("test-key"));
  } finally {
    server.close();
    await rm(dir, { recursive: true, force: true });
  }
  ok("The project address is read from the database user", projectUrl({ DATABASE_URL: "postgresql://app.abcdefghijklmnopqrst:pw@host:5432/postgres" }) === "https://abcdefghijklmnopqrst.supabase.co" && projectUrl({ SUPABASE_URL: "https://x.test/" }) === "https://x.test" && projectUrl({}) === null);
}

async function main() {
  await courseGuard();
  await backups();
  await files();
  ok("The sitemap no longer lists removed pages", !/"\/(credentials|cv)"/.test(readFileSync("src/app/sitemap.ts", "utf8")));
  const indexes = (await db.$queryRawUnsafe<{ n: number }[]>(`select count(*)::int n from pg_constraint k where k.contype = 'f' and k.connamespace = 'public'::regnamespace
    and not exists (select 1 from pg_index i where i.indrelid = k.conrelid and (i.indkey::int2[])[0] = k.conkey[1])`))[0].n;
  ok("Every foreign key has an index", indexes === 0, indexes);
  const loose = (await db.$queryRawUnsafe<{ n: number }[]>(`select count(*)::int n from pg_proc p where p.pronamespace = 'public'::regnamespace and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) x where x like 'search_path=%')`))[0].n;
  ok("Every database function has a fixed search path", loose === 0, loose);
  const anon = await db.$queryRawUnsafe<{ n: string }[]>(`select p.proname::text n from pg_proc p where p.pronamespace = 'public'::regnamespace and has_function_privilege('anon', p.oid, 'execute')`);
  ok("A visitor may call only the newsletter function", anon.length === 1 && anon[0].n === "newsletter_action", anon);
}

main()
  .catch((e) => ok("test run", false, e instanceof Error ? e.message : e))
  .finally(async () => {
    await db.$disconnect();
    for (const r of results) console.log(`${r.pass ? "✔" : "✘"} ${r.name}${r.pass ? "" : `  → ${r.info.slice(0, 400)}`}`);
    const passed = results.filter((r) => r.pass).length;
    console.log(`\n${passed}/${results.length} passed`);
    process.exit(passed === results.length ? 0 : 1);
  });
