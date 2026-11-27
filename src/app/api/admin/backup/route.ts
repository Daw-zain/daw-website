import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { exportBundle } from "@/lib/full-backup";

/**
 * Admin-only download of EVERY database table (website and platform) as one file, without password hashes.
 * Uploaded files are not inside it: `npm run backup` copies them.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user || user.role !== "ADMIN") return new Response("Forbidden", { status: 403 });
  const backup = await exportBundle(db, { passwordHashes: false });
  await audit(user.id, "backup", "database");
  return new Response(JSON.stringify(backup), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="daw-site-full-backup-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.json"`,
      "Cache-Control": "no-store",
    },
  });
}
