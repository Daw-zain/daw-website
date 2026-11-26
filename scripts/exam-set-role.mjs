// Server-side role change for the exams platform (used to create the first admin — never possible from the browser).
// Usage:
//   node --env-file=.env scripts/exam-set-role.mjs <email> <ADMIN|INSTRUCTOR|LEARNER> [authUserId] [name]
// If the person has not opened the exams platform yet, pass their Supabase Auth user id (and name)
// so the ExamMember row is created; otherwise the existing row is updated.
import { PrismaClient } from "@prisma/client";

const [rawEmail, role, authUserId, name = ""] = process.argv.slice(2);
const email = (rawEmail ?? "").toLowerCase().trim();
if (!email || !["ADMIN", "INSTRUCTOR", "LEARNER"].includes(role)) {
  console.error("Usage: node --env-file=.env scripts/exam-set-role.mjs <email> <ADMIN|INSTRUCTOR|LEARNER> [authUserId] [name]");
  process.exit(1);
}
const db = new PrismaClient();
try {
  const existing = await db.examMember.findUnique({ where: { email } });
  let m;
  if (existing) {
    m = await db.examMember.update({ where: { email }, data: { role } });
  } else if (authUserId) {
    m = await db.examMember.create({ data: { email, role, authUserId, name: name || email.split("@")[0] } });
  } else {
    throw Object.assign(new Error("not a member yet"), { code: "NO_MEMBER" });
  }
  await db.examAuditLog.create({ data: { action: "member.role", entity: "ExamMember", entityId: m.id, details: { to: role, via: "server-script" } } });
  console.log(`✔ ${m.email} → ${m.role}${existing ? "" : " (member created)"}`);
} catch (e) {
  console.error(e.code === "NO_MEMBER" ? "✗ Not a member yet: open the exams platform once, or pass the Supabase auth user id" : `✗ ${e.message}`);
  process.exitCode = 1;
} finally {
  await db.$disconnect();
}
