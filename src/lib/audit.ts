import "server-only";
import { db } from "./db";
import { clientIp } from "./auth";

export async function audit(userId: string | null, action: string, entity: string, entityId?: string | null, details?: string) {
  try {
    await db.auditLog.create({
      data: { userId, action, entity, entityId: entityId ?? null, details: details?.slice(0, 2000), ip: await clientIp() },
    });
  } catch (e) {
    console.error("[audit] failed", e);
  }
}
