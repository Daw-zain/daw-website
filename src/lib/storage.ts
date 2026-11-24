import "server-only";
import { mkdir, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

/**
 * Local disk storage.
 *  storage/uploads  → public media, served by /uploads/[...path]
 *  storage/private  → private attachments (e.g. corporate needs files), served only to staff
 * On serverless hosting replace these helpers with S3 / R2 / Blob storage.
 */
export const STORAGE_ROOT = path.join(process.cwd(), "storage");
export const PUBLIC_DIR = path.join(STORAGE_ROOT, "uploads");
export const PRIVATE_DIR = path.join(STORAGE_ROOT, "private");

const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/avif": "avif",
  "image/svg+xml": "svg",
  "application/pdf": "pdf",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "text/csv": "csv",
  "video/mp4": "mp4",
};

export function extFor(file: File) {
  return EXT_BY_MIME[file.type] ?? (file.name.split(".").pop() || "bin").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 6);
}

/** Checks magic bytes for the common types so a renamed file can't pass as a PDF/image. */
function sniffOk(buf: Buffer, mime: string) {
  const hex = buf.subarray(0, 8).toString("hex");
  switch (mime) {
    case "application/pdf":
      return buf.subarray(0, 4).toString() === "%PDF";
    case "image/png":
      return hex.startsWith("89504e47");
    case "image/jpeg":
      return hex.startsWith("ffd8ff");
    case "image/webp":
      return buf.subarray(8, 12).toString() === "WEBP";
    case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    case "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
      return hex.startsWith("504b0304");
    case "application/msword":
    case "application/vnd.ms-excel":
      return hex.startsWith("d0cf11e0");
    case "image/svg+xml": {
      const s = buf.toString("utf8").toLowerCase();
      return s.includes("<svg") && !s.includes("<script") && !/\son\w+=/.test(s);
    }
    default:
      return true;
  }
}

export async function saveFile(file: File, opts: { folder: string; visibility: "public" | "private"; allowed: string[]; maxBytes: number }) {
  if (!opts.allowed.includes(file.type)) throw new Error("type");
  if (file.size === 0 || file.size > opts.maxBytes) throw new Error("size");
  const buf = Buffer.from(await file.arrayBuffer());
  if (!sniffOk(buf, file.type)) throw new Error("type");

  const root = opts.visibility === "public" ? PUBLIC_DIR : PRIVATE_DIR;
  const now = new Date();
  const rel = path.posix.join(opts.folder, `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`, `${crypto.randomBytes(10).toString("hex")}.${extFor(file)}`);
  const abs = path.join(root, ...rel.split("/"));
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, buf);
  return { rel, url: opts.visibility === "public" ? `/uploads/${rel}` : null, size: file.size, mime: file.type };
}

export async function deleteFile(rel: string, visibility: "public" | "private") {
  const root = visibility === "public" ? PUBLIC_DIR : PRIVATE_DIR;
  const abs = path.resolve(root, ...rel.split("/"));
  if (!abs.startsWith(root)) return;
  await unlink(abs).catch(() => {});
}

export function resolveSafe(root: string, parts: string[]) {
  const abs = path.resolve(root, ...parts);
  if (!abs.startsWith(root + path.sep)) return null;
  return abs;
}
