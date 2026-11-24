import { PrismaClient } from "@prisma/client";

/** Tables included in backups, in restore order (parents first). */
export const BACKUP_TABLES = [
  "setting",
  "user",
  "program",
  "courseSession",
  "registration",
  "consultingService",
  "consultationRequest",
  "corporateRequest",
  "contactMessage",
  "resource",
  "favorite",
  "credential",
  "testimonial",
  "stat",
  "faq",
  "subscriber",
  "media",
  "notification",
  "auditLog",
] as const;

export async function buildBackup(db: PrismaClient, opts: { includePasswordHashes: boolean }) {
  const data: Record<string, unknown[]> = {};
  for (const t of BACKUP_TABLES) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let rows: Record<string, unknown>[] = await (db as any)[t].findMany();
    if (t === "user" && !opts.includePasswordHashes) rows = rows.map(({ passwordHash: _p, ...r }) => r);
    data[t] = rows;
  }
  return { format: "daw-site-backup", version: 1, createdAt: new Date().toISOString(), includesPasswordHashes: opts.includePasswordHashes, data };
}
