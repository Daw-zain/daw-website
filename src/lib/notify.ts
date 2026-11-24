import "server-only";
import { db } from "./db";
import { emailLayout, escapeHtml, sendMail } from "./mail";
import { getSettings } from "./settings";
import { siteUrl } from "./utils";

/**
 * Records an admin notification (always visible in the dashboard) and emails the
 * administrator when SMTP is configured.
 */
export async function notifyAdmin(opts: {
  type: string;
  title: string;
  fields: Record<string, string | number | null | undefined>;
  link: string;
  replyTo?: string;
}) {
  const body = Object.entries(opts.fields)
    .filter(([, v]) => v !== null && v !== undefined && v !== "")
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");

  const n = await db.notification.create({
    data: { type: opts.type, title: opts.title, body, link: opts.link },
  });

  const settings = await getSettings();
  const to = settings.adminNotifyEmail || process.env.ADMIN_NOTIFY_EMAIL || process.env.ADMIN_EMAIL;
  if (!to) return;

  const rows = Object.entries(opts.fields)
    .filter(([, v]) => v !== null && v !== undefined && v !== "")
    .map(
      ([k, v]) =>
        `<tr><td style="padding:6px 12px 6px 0;color:#52606D;vertical-align:top;white-space:nowrap">${escapeHtml(k)}</td><td style="padding:6px 0;white-space:pre-wrap">${escapeHtml(String(v))}</td></tr>`,
    )
    .join("");
  const html = emailLayout(
    opts.title,
    `<table cellpadding="0" cellspacing="0" style="font-size:14px">${rows}</table>
     <p style="margin-top:24px"><a href="${siteUrl(opts.link)}" style="background:#1769AA;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">Open in dashboard</a></p>`,
  );
  try {
    const r = await sendMail({ to, subject: `[Website] ${opts.title}`, html, text: body, replyTo: opts.replyTo });
    await db.notification.update({
      where: { id: n.id },
      data: r.sent ? { emailedAt: new Date() } : { emailError: r.reason },
    });
  } catch (e) {
    console.error("[notifyAdmin] email failed", e);
    await db.notification.update({ where: { id: n.id }, data: { emailError: String(e).slice(0, 500) } });
  }
}
