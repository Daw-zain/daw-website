/**
 * Reset the password of an admin/editor account (works even if the old password is forgotten).
 *   npm.cmd run admin:reset-password                       → first admin account
 *   npm.cmd run admin:reset-password -- someone@domain.com → a specific account
 *   npm.cmd run admin:reset-password -- admin@example.com --new-email training@aldaleel.ly
 * The new password is typed hidden and never shown or stored in plain text.
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

function askHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    process.stdout.write(question);
    if (!stdin.isTTY) {
      let data = "";
      stdin.setEncoding("utf8");
      stdin.once("data", (d) => {
        data = String(d).split(/\r?\n/)[0];
        resolve(data);
      });
      return;
    }
    let value = "";
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    const onData = (ch: string) => {
      for (const c of ch) {
        if (c === "\r" || c === "\n") {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off("data", onData);
          process.stdout.write("\n");
          resolve(value);
          return;
        }
        if (c === "\u0003") process.exit(1); // Ctrl-C
        if (c === "\u0008" || c === "\u007f") {
          if (value.length) {
            value = value.slice(0, -1);
            process.stdout.write("\b \b");
          }
        } else {
          value += c;
          process.stdout.write("*");
        }
      }
    };
    stdin.on("data", onData);
  });
}

async function main() {
  const args = process.argv.slice(2);
  const ni = args.indexOf("--new-email");
  const newEmail = ni >= 0 ? (args[ni + 1] || "").trim().toLowerCase() : "";
  const email = args.find((a, i) => !a.startsWith("--") && (ni < 0 || i !== ni + 1))?.trim().toLowerCase();

  const db = new PrismaClient();
  const user = email
    ? await db.user.findUnique({ where: { email } })
    : await db.user.findFirst({ where: { role: "ADMIN" }, orderBy: { createdAt: "asc" } });
  if (!user) throw new Error(email ? `No account found for ${email}` : "No admin account found");
  if (user.role !== "ADMIN" && user.role !== "EDITOR") throw new Error(`${user.email} is not an admin/editor account`);
  if (newEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) throw new Error("--new-email is not a valid email address");
  if (newEmail && newEmail !== user.email && (await db.user.findUnique({ where: { email: newEmail } }))) throw new Error(`${newEmail} is already used by another account`);

  console.log(`Account: ${user.email} (${user.role})${newEmail ? `  →  new login email: ${newEmail}` : ""}`);
  const pw = await askHidden("New password (at least 10 characters): ");
  if (pw.length < 10) throw new Error("Password must be at least 10 characters");
  const again = await askHidden("Repeat the new password: ");
  if (pw !== again) throw new Error("The two passwords do not match");

  await db.user.update({
    where: { id: user.id },
    data: { passwordHash: await bcrypt.hash(pw, 12), active: true, ...(newEmail ? { email: newEmail } : {}) },
  });
  await db.auditLog.create({ data: { userId: user.id, action: "password_reset_cli", entity: "user", entityId: user.id, details: newEmail ? `email → ${newEmail}` : null } });
  await db.$disconnect();
  console.log(`✔ Password updated. Sign in at /admin with ${newEmail || user.email}`);
  process.exit(0);
}

main().catch((e) => {
  console.error("✗", e instanceof Error ? e.message : e);
  process.exit(1);
});
