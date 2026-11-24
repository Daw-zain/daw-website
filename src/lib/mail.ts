import "server-only";
import nodemailer from "nodemailer";

export function smtpConfigured() {
  return !!process.env.SMTP_HOST;
}

let transporter: nodemailer.Transporter | null = null;
function getTransport() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: process.env.SMTP_SECURE === "true",
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } : undefined,
      // fail fast so a wrong host never makes visitors wait on a form
      connectionTimeout: 15000,
      greetingTimeout: 10000,
      socketTimeout: 20000,
    });
  }
  return transporter;
}

/** Non-secret summary of the SMTP configuration (for the admin settings page) */
export function smtpSummary() {
  return {
    configured: smtpConfigured(),
    host: process.env.SMTP_HOST || "",
    port: process.env.SMTP_PORT || "587",
    secure: process.env.SMTP_SECURE === "true",
    user: process.env.SMTP_USER || "",
    hasPassword: !!process.env.SMTP_PASSWORD,
    from: process.env.MAIL_FROM || process.env.SMTP_USER || "",
  };
}

/** Connects and authenticates against the SMTP server without sending anything */
export async function verifySmtp(): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!smtpConfigured()) return { ok: false, error: "SMTP_HOST is not set in .env" };
  try {
    await getTransport().verify();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** Simple branded HTML wrapper for transactional emails */
export function emailLayout(title: string, bodyHtml: string, rtl = false) {
  return `<!doctype html><html dir="${rtl ? "rtl" : "ltr"}"><body style="margin:0;background:#F4F6F8;font-family:Segoe UI,Tahoma,Arial,sans-serif;color:#102A43">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 12px">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#fff;border-radius:12px;overflow:hidden">
<tr><td style="background:#102A43;padding:20px 28px;color:#fff;font-size:18px;font-weight:700">Daw Zainelabideen <span style="color:#C5A15A">·</span> <span style="font-weight:400;font-size:14px">Project Management Training &amp; Consulting</span></td></tr>
<tr><td style="padding:28px"><h1 style="font-size:20px;margin:0 0 16px">${escapeHtml(title)}</h1>${bodyHtml}</td></tr>
</table></td></tr></table></body></html>`;
}

export async function sendMail(opts: { to: string; subject: string; html: string; text?: string; replyTo?: string }) {
  if (!smtpConfigured()) {
    const links = [...opts.html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
    console.info(
      `[mail:disabled] To: ${opts.to} | Subject: ${opts.subject}\n${opts.text ?? opts.html.replace(/<[^>]+>/g, " ").replace(/\s{2,}/g, " ")}${links.length ? `\nLinks: ${links.join(" ")}` : ""}`,
    );
    return { sent: false as const, reason: "SMTP not configured" };
  }
  await getTransport().sendMail({
    from: process.env.MAIL_FROM || process.env.SMTP_USER,
    to: opts.to,
    subject: opts.subject,
    html: opts.html,
    text: opts.text,
    replyTo: opts.replyTo,
  });
  return { sent: true as const };
}
