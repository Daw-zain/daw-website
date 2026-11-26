// Phase 1 exam-system tests — run: node --env-file=.env scripts/test-exams-phase1.mjs
// Everything runs inside ONE transaction that is rolled back at the end: no test data stays in the database.
// Sessions are simulated by setting request.jwt.claims the same way Supabase does for a signed-in user.
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";

const db = new PrismaClient();
const PMP = "cmwx44kbb0001gvkwzr4kyo1l";
const CAPM = "cmwx44lbw0004gvkw5oretlpz";
const results = [];
const ok = (name, pass, info = "") => results.push({ name, pass, info });
const ROLLBACK = new Error("rollback");

const users = {
  admin: { sub: randomUUID(), email: "t-admin@phase1.test" },
  instructor: { sub: randomUUID(), email: "t-instructor@phase1.test" },
  learner: { sub: randomUUID(), email: "t-learner@phase1.test" },
};

try {
  await db.$transaction(async (tx) => {
    const as = (u) => tx.$executeRawUnsafe(`select set_config('request.jwt.claims', $1, true)`, u ? JSON.stringify({ sub: u.sub, email: u.email, role: "authenticated" }) : "");
    const call = async (sql, ...args) => {
      await tx.$executeRawUnsafe("savepoint t");
      try {
        const r = await tx.$queryRawUnsafe(sql, ...args);
        await tx.$executeRawUnsafe("release savepoint t");
        return { value: Object.values(r[0] ?? {})[0] };
      } catch (e) {
        await tx.$executeRawUnsafe("rollback to savepoint t");
        return { error: String(e.meta?.message ?? e.message) };
      }
    };

    // 1. no session
    await as(null);
    let r = await call("select public.exam_me()");
    ok("No session → exam_me refused", /not_authenticated/.test(r.error), r.error);

    // 2. first sign-in registers a LEARNER with no courses
    for (const u of Object.values(users)) { await as(u); await call("select public.exam_me()"); }
    await as(users.learner);
    r = await call("select public.exam_me()");
    ok("First sign-in → LEARNER, no courses", r.value?.role === "LEARNER" && r.value.courses.length === 0, JSON.stringify(r.value));

    // 3. learner cannot use admin functions or open a course he is not enrolled in
    r = await call("select public.exam_admin_members('')");
    ok("Learner → admin list refused", /forbidden/.test(r.error), r.error);
    r = await call("select public.exam_course_folders($1)", CAPM);
    ok("Learner not enrolled → course folders refused", /forbidden/.test(r.error), r.error);

    // 4. bootstrap the first admin (done once from the server side — never from the browser)
    // Inside this rolled-back transaction the test admin is the ONLY admin (real admins are demoted
    // temporarily and restored by the rollback) so the "last admin" rule can be tested.
    await tx.$executeRawUnsafe(`update public."ExamMember" set "role"='LEARNER' where "role"='ADMIN'`);
    await tx.$executeRawUnsafe(`update public."ExamMember" set "role"='ADMIN' where "email"=$1`, users.admin.email);
    await as(users.admin);
    r = await call("select public.exam_me()");
    ok("Admin sees all 10 courses with ADMIN access", r.value?.role === "ADMIN" && r.value.courses.length === 10 && r.value.courses.every((c) => c.access === "ADMIN"), `${r.value?.courses?.length} courses`);

    // 5. admin assigns an instructor to PMP and enrolls the learner in CAPM
    r = await call("select public.exam_admin_assign_instructor($1, $2, $3::jsonb)", PMP, users.instructor.email, JSON.stringify({ canPublishExams: true, canDeleteQuestions: false }));
    ok("Admin assigns instructor to PMP with permissions", r.value?.canPublishExams === true && r.value?.canDeleteQuestions === false, r.error ?? "");
    r = await call("select public.exam_admin_enroll($1, $2)", CAPM, users.learner.email);
    ok("Admin enrolls learner in CAPM", r.value?.status === "ACTIVE", r.error ?? "");
    r = await call("select public.exam_admin_enroll($1, $2)", CAPM, "nobody@phase1.test");
    ok("Enrolling an unknown e-mail → member_not_found", /member_not_found/.test(r.error), r.error);
    r = await call("select public.exam_admin_set_role($1, 'LEARNER')", users.admin.email);
    ok("Removing the last admin → refused", /last_admin/.test(r.error), r.error);

    // 6. instructor: PMP only
    await as(users.instructor);
    r = await call("select public.exam_me()");
    ok("Instructor → role INSTRUCTOR, only PMP, with permissions", r.value?.role === "INSTRUCTOR" && r.value.courses.length === 1 && r.value.courses[0].code === "PMP" && r.value.courses[0].permissions?.canPublishExams === true, JSON.stringify(r.value?.courses?.map((c) => c.code)));
    r = await call("select public.exam_course_folders($1)", PMP);
    ok("Instructor → 5 PMP folders incl. question bank", r.value?.length === 5 && r.value.some((f) => f.kind === "QUESTION_BANK"), `${r.value?.length} folders`);
    r = await call("select public.exam_course_folders($1)", CAPM);
    ok("Instructor of PMP → CAPM refused", /forbidden/.test(r.error), r.error);
    r = await call("select public.exam_course_people($1)", PMP);
    ok("Instructor → PMP people allowed", Array.isArray(r.value?.instructors), r.error ?? "");
    r = await call("select public.exam_course_people($1)", CAPM);
    ok("Instructor of PMP → CAPM people refused", /forbidden/.test(r.error), r.error);
    r = await call("select public.exam_admin_enroll($1, $2)", PMP, users.learner.email);
    ok("Instructor → admin enroll refused", /forbidden/.test(r.error), r.error);

    // 7. learner: CAPM only, never the question bank
    await as(users.learner);
    r = await call("select public.exam_me()");
    ok("Learner → only CAPM", r.value?.courses.length === 1 && r.value.courses[0].code === "CAPM" && r.value.courses[0].access === "LEARNER", JSON.stringify(r.value?.courses?.map((c) => c.code)));
    r = await call("select public.exam_course_folders($1)", CAPM);
    ok("Learner → 4 CAPM folders, no question bank", r.value?.length === 4 && !r.value.some((f) => f.kind === "QUESTION_BANK"), r.value?.map((f) => f.kind).join(","));
    r = await call("select public.exam_course_folders($1)", PMP);
    ok("Learner of CAPM → PMP refused", /forbidden/.test(r.error), r.error);

    // 8. suspended enrollment closes the course
    await as(users.admin);
    await call("select public.exam_admin_enroll($1, $2, 'SUSPENDED')", CAPM, users.learner.email);
    await as(users.learner);
    r = await call("select public.exam_course_folders($1)", CAPM);
    ok("Suspended enrollment → course refused", /forbidden/.test(r.error), r.error);

    // 9. a new course gets its 5 folders automatically
    const [p] = await tx.$queryRawUnsafe(`insert into public."Program" ("id","slug","titleAr","titleEn","summaryAr","summaryEn","descriptionAr","descriptionEn","updatedAt")
      values ('t-phase1-course','t-phase1-course','دورة اختبار','Test course','-','-','-','-',now()) returning "id"`);
    const [f] = await tx.$queryRawUnsafe(`select count(*)::int n, string_agg("kind", ',' order by "sortOrder") k from public."ExamFolder" where "programId"=$1`, p.id);
    ok("New course → 5 folders created automatically", f.n === 5, f.k);

    // 10. sensitive actions are logged
    const [l] = await tx.$queryRawUnsafe(`select count(*)::int n from public."ExamAuditLog" where "createdAt" > now() - interval '5 minutes' and "action" in ('instructor.assign','enrollment.set')`);
    ok("Admin actions written to the exam audit log", l.n >= 3, `${l.n} entries`);

    // ── Phase 2 additions (admin panel functions) ──
    await as(users.admin);
    r = await call("select public.exam_admin_members('phase1.test')");
    const ins = r.value?.find((m) => m.email === users.instructor.email);
    const lea = r.value?.find((m) => m.email === users.learner.email);
    ok("Admin member list: instructor perms + enrollment status included",
      ins?.instructing?.[0]?.programId === PMP && ins.instructing[0].canPublishExams === true && lea?.enrollments?.[0]?.status === "SUSPENDED",
      JSON.stringify({ ins: ins?.instructing, lea: lea?.enrollments }));
    r = await call("select public.exam_admin_set_active($1, false)", users.admin.email);
    ok("Admin cannot disable own account", /cannot_disable_self/.test(r.error), r.error);
    r = await call("select public.exam_admin_set_active($1, false)", users.learner.email);
    ok("Admin disables learner", r.value?.active === false, r.error ?? "");
    await as(users.learner);
    r = await call("select public.exam_me()");
    ok("Disabled member → exam_me refused (account_disabled)", /account_disabled/.test(r.error), r.error);
    await as(users.instructor);
    r = await call("select public.exam_admin_set_active($1, true)", users.learner.email);
    ok("Instructor cannot enable/disable members", /forbidden/.test(r.error), r.error);
    await as(users.admin);
    // (void function: select a constant from it — Prisma cannot read a "void" column)
    r = await call("select 1 as done from public.exam_admin_remove_instructor($1, $2)", PMP, users.instructor.email);
    ok("Admin removes instructor from PMP", r.value === 1, r.error ?? "");
    await as(users.instructor);
    r = await call("select public.exam_course_folders($1)", PMP);
    ok("Removed instructor → PMP refused", /forbidden/.test(r.error), r.error);

    throw ROLLBACK;
  }, { timeout: 60000 });
} catch (e) {
  if (e !== ROLLBACK) { console.error("✗ test run failed:", e.message); process.exitCode = 1; }
}

const [left] = await db.$queryRawUnsafe(`select (select count(*)::int from public."ExamMember" where "email" like '%@phase1.test') m, (select count(*)::int from public."Program" where "id"='t-phase1-course') p`);
ok("Rollback: no test data left in the database", left.m === 0 && left.p === 0, JSON.stringify(left));
await db.$disconnect();

for (const t of results) console.log(`${t.pass ? "✔" : "✗"} ${t.name}${t.pass ? "" : `  ← ${t.info}`}`);
const failed = results.filter((t) => !t.pass).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
if (failed) process.exitCode = 1;
