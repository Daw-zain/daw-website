/**
 * Complete database backup: EVERY table of the public schema (website + exam system), with a restore drill.
 *
 * Not included (they live outside these tables): Supabase sign-in accounts (auth schema) and the files in
 * Supabase Storage. Member records (ExamMember) are included.
 *
 * The files contain personal data and password hashes: they stay in backups/ (never committed to git).
 */
import type { PrismaClient, Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export type Manifest = {
  format: "daw-full-backup";
  version: 1;
  createdAt: string;
  /** parents first: the order rows must be inserted in */
  order: string[];
  tables: Record<string, { rows: number; checksum: string; sha256: string }>;
};

type Tx = Prisma.TransactionClient;
const TX = { timeout: 10 * 60 * 1000, maxWait: 30000 };
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const ident = (name: string) => {
  if (!/^[A-Za-z0-9_]+$/.test(name)) throw new Error(`unexpected table name: ${name}`);
  return `"${name}"`;
};

/** order-independent fingerprint of a table's rows */
async function fingerprint(tx: Tx, from: string): Promise<{ rows: number; checksum: string }> {
  const [r] = await tx.$queryRawUnsafe<{ n: number; h: string }[]>(
    `select count(*)::int n, coalesce(md5(string_agg(j, E'\\n' order by j collate "C")), '') h from (select to_jsonb(t)::text j from ${from} t) s`,
  );
  return { rows: r.n, checksum: r.h };
}

type Fk = { child: string; parent: string; name: string; def: string };
async function schemaInfo(tx: Tx) {
  const tables = (await tx.$queryRawUnsafe<{ t: string }[]>(`select tablename::text t from pg_tables where schemaname = 'public' order by tablename`)).map((r) => r.t);
  const fks = await tx.$queryRawUnsafe<Fk[]>(
    `select c.relname::text child, p.relname::text parent, k.conname::text name, pg_get_constraintdef(k.oid) def
     from pg_constraint k join pg_class c on c.oid = k.conrelid join pg_class p on p.oid = k.confrelid
     where k.contype = 'f' and c.relnamespace = 'public'::regnamespace and p.relnamespace = 'public'::regnamespace`,
  );
  // parents before children (a table's reference to itself is satisfied by one insert statement)
  const order: string[] = [];
  const left = new Set(tables);
  while (left.size) {
    const ready = [...left].filter((t) => fks.every((f) => f.child !== t || f.parent === t || !left.has(f.parent)));
    if (!ready.length) throw new Error(`foreign keys form a cycle: ${[...left].join(", ")}`);
    for (const t of ready) {
      order.push(t);
      left.delete(t);
    }
  }
  return { order, fks };
}

/** writes tables/<name>.json + manifest.json into dir, all read from one consistent snapshot */
export async function dumpAll(db: PrismaClient, dir: string): Promise<Manifest> {
  await mkdir(path.join(dir, "tables"), { recursive: true });
  const files: [string, string][] = [];
  const manifest = await db.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe(`set local timezone = 'UTC'`);
      const { order } = await schemaInfo(tx);
      const m: Manifest = { format: "daw-full-backup", version: 1, createdAt: new Date().toISOString(), order, tables: {} };
      for (const t of order) {
        // kept as the database's own text, so numbers and dates are stored exactly
        const [{ data }] = await tx.$queryRawUnsafe<{ data: string }[]>(`select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb)::text data from public.${ident(t)} t`);
        m.tables[t] = { ...(await fingerprint(tx, `public.${ident(t)}`)), sha256: sha(data) };
        files.push([t, data]);
      }
      return m;
    },
    { ...TX, isolationLevel: "RepeatableRead" },
  );
  for (const [t, data] of files) await writeFile(path.join(dir, "tables", `${t}.json`), data, "utf8");
  await writeFile(path.join(dir, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");
  return manifest;
}

async function load(dir: string) {
  const manifest = JSON.parse(await readFile(path.join(dir, "manifest.json"), "utf8")) as Manifest;
  if (manifest.format !== "daw-full-backup") throw new Error("Not a full backup folder");
  const data: Record<string, string> = {};
  for (const t of manifest.order) {
    data[t] = await readFile(path.join(dir, "tables", `${t}.json`), "utf8");
    if (sha(data[t]) !== manifest.tables[t].sha256) throw new Error(`File of table ${t} was changed or damaged`);
  }
  return { manifest, data };
}

const insertSql = (target: string, table: string) => `insert into ${target} select * from jsonb_populate_recordset(null::public.${ident(table)}, $1::jsonb)`;

/**
 * Restore drill: loads the backup into temporary copies of the tables (same columns, keys and foreign keys),
 * compares every table with the fingerprint taken at backup time, then rolls everything back.
 * Live tables are only read (for their definitions).
 */
export async function drill(db: PrismaClient, dir: string): Promise<{ table: string; rows: number; ok: boolean }[]> {
  const { manifest, data } = await load(dir);
  const results: { table: string; rows: number; ok: boolean }[] = [];
  const DONE = new Error("drill finished");
  try {
    await db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`set local timezone = 'UTC'`);
      const { fks } = await schemaInfo(tx);
      const tmp = (t: string) => ident(`_r_${t}`);
      for (const t of manifest.order) await tx.$executeRawUnsafe(`create temporary table ${tmp(t)} (like public.${ident(t)} including defaults including constraints including indexes) on commit drop`);
      for (const f of fks) {
        const def = f.def.replace(/REFERENCES (?:public\.)?"?[A-Za-z0-9_]+"?\(/, `REFERENCES ${tmp(f.parent)}(`);
        await tx.$executeRawUnsafe(`alter table ${tmp(f.child)} add ${def}`);
      }
      for (const t of manifest.order) {
        await tx.$executeRawUnsafe(insertSql(tmp(t), t), data[t]);
        const got = await fingerprint(tx, tmp(t));
        results.push({ table: t, rows: got.rows, ok: got.rows === manifest.tables[t].rows && got.checksum === manifest.tables[t].checksum });
      }
      throw DONE;
    }, TX);
  } catch (e) {
    if (e !== DONE) throw e;
  }
  return results;
}

/** ⚠ Replaces ALL rows of the connected database with the backup, in one transaction (all or nothing). */
export async function restoreAll(db: PrismaClient, dir: string) {
  const { manifest, data } = await load(dir);
  await db.$transaction(async (tx) => {
    const { order } = await schemaInfo(tx);
    const missing = manifest.order.filter((t) => !order.includes(t));
    if (missing.length) throw new Error(`Run "npm run supabase:setup" first: missing tables ${missing.join(", ")}`);
    for (const t of [...order].reverse()) await tx.$executeRawUnsafe(`delete from public.${ident(t)}`);
    for (const t of manifest.order) {
      // inserting programs creates their system folders by trigger: the backup's folders replace them
      if (t === "ExamFolder") await tx.$executeRawUnsafe(`delete from public."ExamFolder"`);
      await tx.$executeRawUnsafe(insertSql(`public.${ident(t)}`, t), data[t]);
      const got = await fingerprint(tx, `public.${ident(t)}`);
      if (got.rows !== manifest.tables[t].rows) throw new Error(`${t}: expected ${manifest.tables[t].rows} rows, got ${got.rows}`);
    }
  }, TX);
  return manifest;
}
