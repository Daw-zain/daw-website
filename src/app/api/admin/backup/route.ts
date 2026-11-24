import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { buildBackup } from "@/lib/backup";

/** Admin-only JSON backup download (password hashes are excluded; use `npm run backup` on the server for a full backup). */
export async function GET() {
  const user = await getCurrentUser();
  if (!user || user.role !== "ADMIN") return new Response("Forbidden", { status: 403 });
  const backup = await buildBackup(db, { includePasswordHashes: false });
  await audit(user.id, "backup", "database");
  return new Response(JSON.stringify(backup, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="daw-site-backup-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.json"`,
      "Cache-Control": "no-store",
    },
  });
}
