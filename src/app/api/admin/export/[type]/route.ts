import { getCurrentUser } from "@/lib/auth";
import { INBOX, type InboxKey } from "@/lib/inbox";
import { INBOX_VIEW } from "@/lib/inbox-config";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { csvResponse, toCsv } from "@/lib/csv";
import { siteUrl } from "@/lib/utils";

export async function GET(req: Request, ctx: { params: Promise<{ type: string }> }) {
  const user = await getCurrentUser();
  if (!user || (user.role !== "ADMIN" && user.role !== "EDITOR")) return new Response("Unauthorized", { status: 401 });
  const { type } = await ctx.params;

  if (type === "subscribers") {
    if (user.role !== "ADMIN") return new Response("Forbidden", { status: 403 });
    const subs = await db.subscriber.findMany({ orderBy: { createdAt: "desc" } });
    await audit(user.id, "export", "subscriber");
    return csvResponse(
      "subscribers",
      toCsv(
        ["email", "language", "status", "created", "confirmed", "unsubscribe_url"],
        subs.map((s) => [s.email, s.locale, s.unsubscribedAt ? "unsubscribed" : s.confirmedAt ? "confirmed" : "pending", s.createdAt, s.confirmedAt, siteUrl(`/${s.locale}/newsletter?action=unsubscribe&token=${s.token}`)]),
      ),
    );
  }

  if (!(type in INBOX)) return new Response("Not found", { status: 404 });
  const key = type as InboxKey;
  const status = new URL(req.url).searchParams.get("status");
  const where = status && (INBOX[key].statuses as readonly string[]).includes(status) ? { status } : {};
  const view = INBOX_VIEW[key];
  const rows = await view.load(where);
  await audit(user.id, "export", INBOX[key].model, null, status ?? "all");
  return csvResponse(
    key,
    toCsv(
      [...view.cols.map((c) => c.label.en), "Admin notes"],
      rows.map((r) => [...view.cols.map((c) => r[c.key]), r.adminNotes]),
    ),
  );
}
