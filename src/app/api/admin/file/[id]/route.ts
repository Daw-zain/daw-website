import { readFile } from "node:fs/promises";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { PRIVATE_DIR, resolveSafe } from "@/lib/storage";
import { audit } from "@/lib/audit";

/** Staff-only download of a corporate request attachment */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user || (user.role !== "ADMIN" && user.role !== "EDITOR")) return new Response("Unauthorized", { status: 401 });
  const { id } = await ctx.params;
  const r = await db.corporateRequest.findUnique({ where: { id } });
  if (!r?.attachmentPath) return new Response("Not found", { status: 404 });
  const abs = resolveSafe(PRIVATE_DIR, r.attachmentPath.split("/"));
  if (!abs) return new Response("Not found", { status: 404 });
  try {
    const data = await readFile(abs);
    await audit(user.id, "download", "corporateRequest", id, r.attachmentName ?? "");
    const name = (r.attachmentName ?? "attachment").replace(/[^\w.\- ]+/g, "_");
    return new Response(new Uint8Array(data), {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="${name}"; filename*=UTF-8''${encodeURIComponent(r.attachmentName ?? "attachment")}`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
