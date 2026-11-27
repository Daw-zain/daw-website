/** Backups made before the platform existed (website tables only), and the guard around restoring them. */
import type { PrismaClient, Prisma } from "@prisma/client";

export const WEBSITE_ONLY_FORMAT = "daw-site-backup";

/** their tables, in restore order (parents first) */
const TABLES = [
  "setting", "user", "program", "courseSession", "registration", "consultingService", "consultationRequest", "corporateRequest",
  "contactMessage", "resource", "favorite", "credential", "testimonial", "stat", "faq", "subscriber", "media", "notification", "auditLog",
] as const;

/** what an old website-only restore would destroy */
export async function platformData(db: PrismaClient | Prisma.TransactionClient): Promise<string[]> {
  const counts = {
    members: await db.examMember.count(),
    questions: await db.question.count(),
    tests: await db.exam.count(),
    attempts: await db.examAttempt.count(),
    enrolments: await db.enrollment.count(),
    "course files": await db.courseItem.count(),
  };
  return Object.entries(counts).filter(([, n]) => n > 0).map(([k, n]) => `${n} ${k}`);
}

const DATE_KEYS = /(At|Date)$/;

export async function restoreWebsiteOnly(db: PrismaClient, backup: { data: Record<string, Record<string, unknown>[]>; includesPasswordHashes?: boolean }, log: (line: string) => void) {
  await db.$transaction(async (tx) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tm = (t: string) => (tx as any)[t];
    for (const t of [...TABLES].reverse()) await tm(t).deleteMany();
    for (const t of TABLES) {
      const rows = backup.data[t] ?? [];
      for (const r of rows) {
        for (const [k, v] of Object.entries(r)) if (DATE_KEYS.test(k) && typeof v === "string") r[k] = new Date(v);
        if (t === "user" && !r.passwordHash) r.passwordHash = "!reset-required"; // JSON downloads exclude hashes
        await tm(t).create({ data: r });
      }
      log(`✔ ${t}: ${rows.length}`);
    }
  }, { timeout: 10 * 60 * 1000 });
  if (!backup.includesPasswordHashes) log("! This backup had no password hashes: reset passwords with `npm run db:seed` (admin) or from the dashboard.");
}
