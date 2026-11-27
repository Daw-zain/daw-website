/**
 * Copies the files kept in Supabase Storage (course files and videos, question attachments, member
 * documents, covers) into backups/files/<bucket>/<path>.
 *
 * It is a mirror that only grows: a file already copied with the same size is skipped, and a file later
 * deleted online is kept here. Reading private files needs the project's secret key, which stays in the
 * local .env file only.
 */
import { createWriteStream } from "node:fs";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

export type StoredObject = { bucket: string; name: string; size: number };
export type MirrorResult = { files: StoredObject[]; copied: number; present: number; failed: { file: string; reason: string }[] };

const PAGE = 100;

/** a storage name becomes a local path only if no part of it can climb out of the folder */
export function localPath(root: string, bucket: string, name: string): string | null {
  const parts = [bucket, ...name.split("/")];
  const bad = (p: string) => !p || p === "." || p === ".." || /[<>:"\\|?*\x00-\x1f]/.test(p) || /[. ]$/.test(p) || /^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(p);
  return parts.some(bad) ? null : path.join(root, ...parts);
}

/** the project address, from SUPABASE_URL or from the database user ("role.<project>") */
export function projectUrl(env: Record<string, string | undefined>): string | null {
  const explicit = env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
  if (explicit) return explicit.replace(/\/+$/, "");
  const ref = env.DATABASE_URL?.match(/^postgres(?:ql)?:\/\/[A-Za-z0-9_]+\.([a-z0-9]{20}):/)?.[1];
  return ref ? `https://${ref}.supabase.co` : null;
}

export async function mirrorStorage(opts: { url: string; key: string; dir: string; log?: (line: string) => void }): Promise<MirrorResult> {
  const headers = { apikey: opts.key, authorization: `Bearer ${opts.key}` };
  const call = async (address: string, init: RequestInit = {}) => {
    const r = await fetch(`${opts.url}/storage/v1/${address}`, { ...init, headers: { ...headers, ...(init.body ? { "content-type": "application/json" } : {}) } });
    if (!r.ok) throw new Error(`storage answered ${r.status} for ${address.split("?")[0]}`);
    return r;
  };

  const buckets = ((await (await call("bucket")).json()) as { id: string }[]).map((b) => b.id).sort();
  const files: StoredObject[] = [];
  for (const bucket of buckets) {
    const folders = [""];
    while (folders.length) {
      const prefix = folders.shift() as string;
      for (let offset = 0; ; offset += PAGE) {
        const page = (await (
          await call(`object/list/${encodeURIComponent(bucket)}`, { method: "POST", body: JSON.stringify({ prefix, limit: PAGE, offset, sortBy: { column: "name", order: "asc" } }) })
        ).json()) as { name: string; id: string | null; metadata: { size?: number } | null }[];
        for (const entry of page) {
          const name = prefix ? `${prefix}/${entry.name}` : entry.name;
          // folders come without an id
          if (entry.id === null) folders.push(name);
          else files.push({ bucket, name, size: Number(entry.metadata?.size ?? 0) });
        }
        if (page.length < PAGE) break;
      }
    }
  }

  const result: MirrorResult = { files, copied: 0, present: 0, failed: [] };
  for (const f of files) {
    const label = `${f.bucket}/${f.name}`;
    const target = localPath(opts.dir, f.bucket, f.name);
    if (!target) {
      result.failed.push({ file: label, reason: "unsafe name" });
      continue;
    }
    const have = await stat(target).catch(() => null);
    if (have?.isFile() && have.size === f.size) {
      result.present++;
      continue;
    }
    const part = `${target}.part`;
    try {
      const r = await call(`object/${encodeURIComponent(f.bucket)}/${f.name.split("/").map(encodeURIComponent).join("/")}`);
      if (!r.body) throw new Error("empty answer");
      await mkdir(path.dirname(target), { recursive: true });
      await pipeline(Readable.fromWeb(r.body as import("node:stream/web").ReadableStream), createWriteStream(part));
      const got = (await stat(part)).size;
      if (got !== f.size) throw new Error(`received ${got} of ${f.size} bytes`);
      await rename(part, target);
      result.copied++;
      opts.log?.(`  + ${label}`);
    } catch (e) {
      await rm(part, { force: true });
      result.failed.push({ file: label, reason: e instanceof Error ? e.message : String(e) });
    }
  }
  return result;
}
