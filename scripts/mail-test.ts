/**
 * Check the SMTP settings in .env and send a test email.
 *   npm run mail:test -- you@yourdomain.com
 * Without an address it only verifies the connection and login.
 */
import nodemailer from "nodemailer";

async function main() {
  const to = process.argv[2];
  const host = process.env.SMTP_HOST;
  if (!host) throw new Error("SMTP_HOST is empty in .env");
  const port = Number(process.env.SMTP_PORT || 587);
  const secure = process.env.SMTP_SECURE === "true";
  console.log(`Connecting to ${host}:${port} (${secure ? "SSL" : "STARTTLS"}) as ${process.env.SMTP_USER || "(no auth)"} …`);

  const t = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } : undefined,
    connectionTimeout: 15000,
    greetingTimeout: 10000,
    socketTimeout: 20000,
  });
  await t.verify();
  console.log("✔ Connection and login OK");

  if (to) {
    const info = await t.sendMail({
      from: process.env.MAIL_FROM || process.env.SMTP_USER,
      to,
      subject: "Test email – Daw Zainelabideen website",
      text: "This test email confirms that the website can send notifications.\nتؤكد هذه الرسالة أن الموقع قادر على إرسال الإشعارات.",
    });
    console.log(`✔ Test email sent to ${to} (message id ${info.messageId})`);
  }
}

main().catch((e) => {
  console.error("✗ SMTP test failed:", e instanceof Error ? e.message : e);
  console.error("  Common fixes: port 465 → SMTP_SECURE=\"true\"; port 587 → SMTP_SECURE=\"false\"; check user/password; MAIL_FROM must be an address your server allows.");
  process.exit(1);
});
