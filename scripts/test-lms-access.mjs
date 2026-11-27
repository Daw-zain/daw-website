// LMS-1: roles, permissions and the activity log.
// run: node --env-file=.env scripts/test-lms-access.mjs — one transaction, rolled back at the end.
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";

const db = new PrismaClient();
const ROLLBACK = new Error("rollback");
const results = [];
const ok = (name, pass, info = "") => results.push({ name, pass: !!pass, info });
const u = (n) => ({ sub: randomUUID(), email: `t-${n}@lms1.test` });
const users = {
  boss: u("boss"), staff: u("staff"), empty: u("empty"), res: u("results"), reader: u("reader"),
  inst: u("inst"), learner: u("learner"), friend: u("friend"), staff2: u("staff2"),
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const denied = (r) => /forbidden|super_admin_only/.test(r.error ?? "");

const countSql = `select (select count(*)::int from public."ExamMember") m, (select count(*)::int from public."AdminRole") r, (select count(*)::int from public."Question") q,
  (select count(*)::int from public."Enrollment") e, (select count(*)::int from public."ExamAttempt") a, (select string_agg("email" || ':' || "role", ',' order by "email") from public."ExamMember") roles`;
const [before] = await db.$queryRawUnsafe(countSql);

try {
  await db.$transaction(async (tx) => {
    const as = (x) => tx.$executeRawUnsafe(`select set_config('request.jwt.claims', $1, true)`, x ? JSON.stringify({ sub: x.sub, email: x.email, role: "authenticated" }) : "");
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
    const cast = (v) => (v === null ? "::text" : typeof v === "object" ? "::jsonb" : typeof v === "boolean" ? "::boolean" : typeof v === "number" ? "::int" : "");
    const j = (fn, ...a) => call(`select public.${fn}(${a.map((v, i) => `$${i + 1}${cast(v)}`).join(",")})`, ...a.map((x) => (typeof x === "object" && x !== null ? JSON.stringify(x) : x)));
    const v = (fn, ...a) => j(fn, ...a).then((r) => { if (r.error) throw new Error(`${fn}: ${r.error}`); return r.value; });
    // exam_admin_remove_instructor returns void
    const run = (fn, ...a) => call(`select public.${fn}(${a.map((_, i) => `$${i + 1}`).join(",")})::text`, ...a);
    const resetRate = () => tx.$executeRawUnsafe(`delete from public."ExamRateLimit"`);
    const member = async (x) => (await tx.$queryRawUnsafe(`select * from public."ExamMember" where "email"=$1`, x.email))[0];

    const [c1, c2] = (await tx.$queryRawUnsafe(`select "id" from public."Program" p where not exists (select 1 from public."Question" q where q."programId"=p."id") order by p."order" limit 2`)).map((r) => r.id);
    for (const x of Object.values(users)) { await as(x); await v("exam_me"); }
    // the only super admin of this test is "boss" (rolled back afterwards)
    await tx.$executeRawUnsafe(`update public."ExamMember" set "role"='LEARNER' where "role"='ADMIN'`);
    await tx.$executeRawUnsafe(`update public."ExamMember" set "role"='ADMIN' where "email"=$1`, users.boss.email);

    // ── super admin ──
    await as(users.boss);
    const cat = (await v("exam_roles")).catalogue;
    let me = await v("exam_me");
    ok("Super admin holds every permission and every course", same(me.platform, cat) && me.courses.length >= 10 && me.courses.every((c) => c.access === "ADMIN"), JSON.stringify(me.platform));
    const seed = (await v("exam_roles")).roles.find((r) => r.key === "admin");
    ok("The built-in Admin role exists, without question delete or export", seed?.system && !seed.permissions.question_bank.includes("delete") && !seed.permissions.question_bank.includes("export") && !seed.permissions.audit.includes("export"), JSON.stringify(seed?.permissions));

    // ── role definitions ──
    let r = await j("exam_role_save", { nameAr: " ", permissions: {} });
    ok("A role needs a name", /name_missing/.test(r.error ?? ""), r.error);
    r = await j("exam_role_save", { nameAr: "س", permissions: { payments: ["read"] } });
    ok("Unknown section refused", /invalid_permissions/.test(r.error ?? ""), r.error);
    r = await j("exam_role_save", { nameAr: "س", permissions: { users: ["delete"] } });
    ok("Unknown action refused", /invalid_permissions/.test(r.error ?? ""), r.error);
    r = await j("exam_role_save", { nameAr: seed.nameAr, permissions: {} });
    ok("Two roles cannot share a name", /name_used/.test(r.error ?? ""), r.error);
    const rEmpty = await v("exam_role_save", { nameAr: "بلا صلاحيات", permissions: {} });
    const rRes = await v("exam_role_save", { nameAr: "متابع النتائج", permissions: { results: ["update"] } });
    ok("Dependencies are added: grading results includes reading results and the question banks", same(rRes.permissions, { results: ["read", "update"], question_bank: ["read"] }), JSON.stringify(rRes.permissions));
    const rRead = await v("exam_role_save", { nameAr: "قارئ المستخدمين", permissions: { users: ["read"] } });
    const rTmp = await v("exam_role_save", { nameAr: "مؤقت", permissions: { trainers: ["update"] } });
    ok("Managing trainers includes the member list", same(rTmp.permissions, { users: ["read"], trainers: ["update"] }), JSON.stringify(rTmp.permissions));

    // ── giving roles ──
    r = await j("exam_admin_set_role", users.staff.email, "STAFF");
    ok("An admin needs a role", /invalid_admin_role/.test(r.error ?? ""), r.error);
    r = await j("exam_admin_set_role", users.staff.email, "STAFF", "nope");
    ok("An unknown role is refused", /invalid_admin_role/.test(r.error ?? ""), r.error);
    await v("exam_admin_set_role", users.staff.email, "STAFF", seed.id);
    await v("exam_admin_set_role", users.staff2.email, "STAFF", seed.id);
    await v("exam_admin_set_role", users.empty.email, "STAFF", rEmpty.id);
    await v("exam_admin_set_role", users.res.email, "STAFF", rRes.id);
    await v("exam_admin_set_role", users.reader.email, "STAFF", rRead.id);
    await v("exam_admin_assign_instructor", c1, users.inst.email, {});
    await v("exam_admin_enroll", c1, users.learner.email);
    r = await j("exam_admin_set_role", users.boss.email, "LEARNER");
    ok("The last super admin cannot be removed", /last_admin/.test(r.error ?? ""), r.error);
    r = await j("exam_role_delete", seed.id);
    ok("A built-in role cannot be deleted", /role_system/.test(r.error ?? ""), r.error);
    r = await j("exam_role_delete", rRead.id);
    ok("A role that members hold cannot be deleted", /role_in_use/.test(r.error ?? ""), r.error);
    r = await run("exam_role_delete", rTmp.id);
    ok("An unused role can be deleted", !r.error && !(await v("exam_roles")).roles.some((x) => x.id === rTmp.id), r.error);

    // content used below
    await as(users.inst);
    const q = await v("exam_bank_question_save", c1, { type: "TRUE_FALSE", stemAr: "سؤال الاختبار", status: "ACTIVE", answer: { value: true } });
    const dom = (await v("exam_course_folders", c1)).find((f) => f.kind === "DOMAIN_TESTS").id;
    const ex = await v("exam_exam_save", { folderId: dom, titleAr: "اختبار", durationMinutes: 10, items: [{ questionId: q.id }] });
    const pend = await v("exam_exam_publish", ex.id);
    ok("A trainer without publishing rights sends the exam for approval", pend.status === "PENDING_APPROVAL", pend.status);

    // ── an admin with the built-in role ──
    await as(users.staff);
    me = await v("exam_me");
    ok("exam_me reports the role and only its permissions", me.role === "STAFF" && me.adminRole?.nameEn === "Admin" && me.platform.users.includes("update") && !me.platform.settings && !me.platform.question_bank.includes("delete"), JSON.stringify(me.platform));
    const cs = me.courses.find((c) => c.programId === c2);
    ok("…and sees every course with the matching course permissions", cs?.access === "INSTRUCTOR" && cs.viaRole === true && cs.permissions.canEditQuestions && cs.permissions.canViewResults && !cs.permissions.canDeleteQuestions && !cs.permissions.canExport, JSON.stringify(cs));
    r = await j("exam_admin_members", "");
    ok("Reads the member list", Array.isArray(r.value) && r.value.some((m) => m.email === users.res.email && m.adminRole?.nameAr === rRes.nameAr), r.error);
    r = await j("exam_admin_courses");
    ok("Gets every course with the permissions they may pass on", r.value?.length >= 10 && r.value.every((c) => c.mine.canEditQuestions === true && c.mine.canExport === false && c.mine.canDeleteQuestions === false), r.error ?? JSON.stringify(r.value?.[0]));
    r = await j("exam_admin_set_role", users.friend.email, "INSTRUCTOR");
    ok("Switches a trainee to trainer", r.value?.role === "INSTRUCTOR", r.error);
    await v("exam_admin_set_role", users.friend.email, "LEARNER");
    for (const [label, args] of [
      ["cannot create a super admin", [users.friend.email, "ADMIN"]],
      ["cannot create an admin", [users.friend.email, "STAFF", seed.id]],
      ["cannot demote the super admin", [users.boss.email, "LEARNER"]],
      ["cannot change another admin", [users.staff2.email, "LEARNER"]],
      ["cannot change their own role", [users.staff.email, "INSTRUCTOR"]],
    ]) {
      r = await j("exam_admin_set_role", ...args);
      ok(`Escalation: ${label}`, denied(r), r.error ?? "allowed");
    }
    r = await j("exam_admin_set_active", users.boss.email, false);
    ok("Escalation: cannot disable the super admin", denied(r), r.error ?? "allowed");
    r = await j("exam_admin_set_active", users.friend.email, false);
    ok("Disables a trainee account", r.value?.active === false, r.error);
    await as(users.friend);
    r = await j("exam_me");
    ok("A disabled account is refused at once", /account_disabled/.test(r.error ?? ""), r.error);
    await as(users.staff);
    await v("exam_admin_set_active", users.friend.email, true);
    r = await j("exam_role_save", { id: seed.id, nameAr: "x", permissions: cat });
    ok("Escalation: cannot edit roles", denied(r), r.error ?? "allowed");
    r = await run("exam_role_delete", rEmpty.id);
    ok("Escalation: cannot delete roles", denied(r), r.error ?? "allowed");
    r = await j("exam_admin_enroll", c1, users.friend.email, "ACTIVE");
    ok("Enrols a trainee", r.value?.status === "ACTIVE", r.error);
    r = await j("exam_admin_assign_instructor", c1, users.friend.email, { canDeleteQuestions: false, canExport: false });
    ok("Assigns a trainer with permissions they hold", r.value?.canEditQuestions === true, r.error);
    r = await j("exam_admin_assign_instructor", c1, users.friend.email, { canExport: true });
    ok("Escalation: cannot grant a course permission they lack (export)", /cannot_grant/.test(r.error ?? ""), r.error ?? "granted");
    r = await j("exam_admin_assign_instructor", c2, users.friend.email, { canDeleteQuestions: true });
    ok("Escalation: …nor through a new assignment (delete)", /cannot_grant/.test(r.error ?? ""), r.error ?? "granted");
    const [n2] = await tx.$queryRawUnsafe(`select count(*)::int n from public."CourseInstructor" where "programId"=$1`, c2);
    ok("…and a refused assignment leaves nothing behind", n2.n === 0, String(n2.n));
    r = await j("exam_admin_assign_instructor", c1, users.staff.email, {});
    ok("Escalation: cannot assign themselves", denied(r), r.error ?? "allowed");
    r = await j("exam_admin_assign_instructor", c1, users.staff2.email, {});
    ok("Escalation: cannot assign another admin", denied(r), r.error ?? "allowed");
    // a permission the super admin gave stays, and the admin may still save the trainer's other settings
    await as(users.boss);
    await v("exam_admin_assign_instructor", c1, users.friend.email, { canExport: true });
    await as(users.staff);
    r = await j("exam_admin_assign_instructor", c1, users.friend.email, { canExport: true, canEditQuestions: false });
    ok("An already granted permission can be kept while changing others", r.value?.canExport === true && r.value.canEditQuestions === false, r.error);
    r = await run("exam_admin_remove_instructor", c1, users.friend.email);
    ok("Removes a trainer from a course", !r.error, r.error);
    r = await j("exam_bank_questions", c1, {});
    ok("Works in the question bank of any course", r.value?.total === 1, r.error);
    r = await j("exam_bank_question_bulk", c1, "delete", [q.id], {});
    ok("…but cannot delete questions", denied(r), r.error ?? JSON.stringify(r.value));
    r = await j("exam_bank_export", c1, {});
    ok("…nor export them", denied(r), r.error ?? "exported");
    r = await j("exam_exam_review", pend.id, true, "");
    ok("Approves a pending exam (publish permission)", r.value?.status === "PUBLISHED" || r.value?.exam?.status === "PUBLISHED", r.error ?? JSON.stringify(r.value).slice(0, 200));
    r = await j("exam_admin_set_mastery", 3);
    ok("Without the settings permission the mastery policy is refused", denied(r), r.error ?? "changed");
    await resetRate();
    r = await j("exam_audit", {});
    ok("Reads the activity log", r.value?.total > 0 && r.value.items.some((x) => x.action === "member.role" && x.actorEmail === users.boss.email), r.error);
    r = await j("exam_audit", { export: true });
    ok("…but cannot export it", denied(r), r.error ?? "exported");
    r = await j("exam_security_log", 10);
    ok("Sees the security alerts (audit permission)", !r.error, r.error);

    // ── an admin whose role grants nothing ──
    await as(users.empty);
    me = await v("exam_me");
    ok("A role without permissions: no sections, no courses", same(me.platform, {}) && me.courses.length === 0, JSON.stringify([me.platform, me.courses.length]));
    const attempts = [
      ["exam_admin_members", [""]], ["exam_admin_set_role", [users.friend.email, "INSTRUCTOR"]], ["exam_admin_set_active", [users.friend.email, false]],
      ["exam_admin_assign_instructor", [c1, users.friend.email, {}]], ["exam_admin_enroll", [c1, users.friend.email, "ACTIVE"]], ["exam_roles", []], ["exam_admin_courses", []],
      ["exam_role_save", [{ nameAr: "z", permissions: {} }]], ["exam_audit", [{}]], ["exam_admin_set_mastery", [3]], ["exam_security_log", [10]],
      ["exam_bank_questions", [c1, {}]], ["exam_bank_question", [q.id]], ["exam_bank_question_save", [c1, { type: "TRUE_FALSE", stemAr: "z", answer: { value: true } }]],
      ["exam_analytics_course", [c1, {}]], ["exam_exam_get", [ex.id]], ["exam_exam_review", [ex.id, true, ""]], ["exam_course_folders", [c1]], ["exam_course_people", [c1]],
    ];
    const leaked = [];
    for (const [fn, a] of attempts) {
      const x = await j(fn, ...a);
      if (!denied(x)) leaked.push(`${fn}: ${x.error ?? "allowed"}`);
    }
    ok(`…and all ${attempts.length} staff functions refuse`, leaked.length === 0, leaked.join(" | "));
    ok("…including the stored images", (await v("exam_storage_can", `${c1}/${q.id}/a.png`, "read")) === false && (await v("exam_storage_can", `${c1}/${q.id}/a.png`, "write")) === false, "");

    // ── results-only role ──
    await as(users.res);
    await resetRate();
    r = await j("exam_analytics_course", c1, {});
    ok("Results role opens course reports", !r.error, r.error);
    r = await j("exam_bank_question_save", c1, { type: "TRUE_FALSE", stemAr: "z", answer: { value: true } });
    ok("…cannot add questions", denied(r), r.error ?? "saved");
    r = await j("exam_exam_save", { folderId: dom, titleAr: "z", items: [] });
    ok("…cannot build tests", denied(r), r.error ?? "saved");
    r = await j("exam_admin_members", "");
    ok("…cannot see the member list", denied(r), r.error ?? "listed");

    // ── users:read only ──
    await as(users.reader);
    r = await j("exam_admin_members", "");
    ok("A read-only users role lists members", Array.isArray(r.value), r.error);
    r = await j("exam_admin_set_active", users.friend.email, false);
    ok("…but changes nothing", denied(r), r.error ?? "changed");
    r = await j("exam_admin_enroll", c1, users.friend.email, "SUSPENDED");
    ok("…and enrols nobody", denied(r), r.error ?? "changed");

    // ── trainers and trainees keep their old limits ──
    await as(users.inst);
    for (const [fn, a] of [["exam_admin_members", [""]], ["exam_audit", [{}]], ["exam_roles", []], ["exam_exam_review", [ex.id, true, ""]]]) {
      r = await j(fn, ...a);
      ok(`A trainer cannot call ${fn}`, denied(r), r.error ?? "allowed");
    }
    r = await j("exam_bank_questions", c2, {});
    ok("A trainer still cannot open another course's bank", denied(r), r.error ?? "opened");
    // a role id left on a non-admin must grant nothing
    await tx.$executeRawUnsafe(`update public."ExamMember" set "adminRoleId"=$1 where "email"=$2`, seed.id, users.learner.email);
    await as(users.learner);
    r = await j("exam_admin_members", "");
    me = await v("exam_me");
    ok("A role only works for the Admin base role", denied(r) && same(me.platform, {}) && me.courses.length === 1 && me.courses[0].access === "LEARNER", r.error ?? "allowed");

    // ── a trainer who becomes a trainee ──
    await as(users.boss);
    await v("exam_admin_set_role", users.inst.email, "LEARNER");
    await as(users.inst);
    const lost = [await j("exam_bank_questions", c1, {}), await j("exam_analytics_course", c1, {}), await j("exam_security_log", 10), await j("exam_bank_question_save", c1, { type: "TRUE_FALSE", stemAr: "z", answer: { value: true } })];
    me = await v("exam_me");
    ok("A trainer switched to trainee loses the course permissions at once", lost.every(denied) && me.courses.every((c) => c.access === "LEARNER" && !c.permissions), JSON.stringify([lost.map((x) => x.error ?? "allowed"), me.courses]));
    await as(users.boss);
    await v("exam_admin_set_role", users.inst.email, "INSTRUCTOR");
    await as(users.inst);
    r = await j("exam_bank_questions", c1, {});
    ok("…and gets the same assignments back when made trainer again", r.value?.total === 1, r.error);

    // ── switching a role off, and leaving it ──
    await as(users.boss);
    const custom = await v("exam_role_save", { nameAr: "محرر البنك", permissions: { question_bank: ["update"] } });
    await v("exam_admin_set_role", users.empty.email, "STAFF", custom.id);
    await as(users.empty);
    r = await j("exam_bank_question_save", c2, { type: "TRUE_FALSE", stemAr: "من الدور", answer: { value: true } });
    ok("A question-bank role adds questions in any course", !!r.value?.id, r.error);
    ok("…and may upload images there", (await v("exam_storage_can", `${c2}/x/a.png`, "write")) === true, "");
    await as(users.boss);
    await v("exam_role_save", { ...custom, active: false });
    await as(users.empty);
    r = await j("exam_bank_questions", c2, {});
    ok("Switching the role off removes its permissions at once", denied(r), r.error ?? "still allowed");
    await as(users.boss);
    r = await j("exam_admin_set_role", users.staff2.email, "STAFF", custom.id);
    ok("A switched-off role cannot be assigned", /invalid_admin_role/.test(r.error ?? ""), r.error ?? "assigned");
    await v("exam_admin_set_role", users.staff2.email, "LEARNER");
    ok("Leaving the Admin role clears the role link", (await member(users.staff2)).adminRoleId === null, "");

    // ── activity log ──
    await resetRate();
    r = await v("exam_audit", { area: "role" });
    const upd = r.items.find((x) => x.action === "role.update");
    ok("Role changes are logged with who, before and after", r.items.length >= 5 && r.items.every((x) => x.action.startsWith("role.")) && upd?.actorEmail === users.boss.email && upd.details.before && upd.details.after, JSON.stringify(upd));
    r = await v("exam_audit", { q: users.staff.email });
    ok("Filter by person", r.total > 0 && r.items.every((x) => x.actorEmail === users.staff.email), String(r.total));
    r = await v("exam_audit", { from: "2999-01-01" });
    ok("Filter by date", r.total === 0 && r.items.length === 0, String(r.total));
    await tx.$executeRawUnsafe(`insert into public."AuditLog" ("id","action","entity","details","createdAt") values ($1,'login','User','لوحة الموقع',now())`, `t-${randomUUID()}`);
    r = await v("exam_audit", { source: "website" });
    ok("The website dashboard's log is included", r.total >= 1 && r.items.every((x) => x.source === "website") && r.items.some((x) => x.details?.text === "لوحة الموقع"), JSON.stringify(r.items[0]));
    const all = await v("exam_audit", {});
    const p2 = await v("exam_audit", { page: 2 });
    ok("The log is paged, newest first, 50 per page", all.items.length === 50 && p2.items.length > 0 && all.items[49].at >= p2.items[0].at && all.areas.includes("member"), JSON.stringify([all.items.length, p2.items.length]));
    r = await j("exam_audit", { export: true });
    const [ex1] = await tx.$queryRawUnsafe(`select count(*)::int n from public."ExamAuditLog" where "action"='audit.export'`);
    ok("The super admin exports the log, and the export is itself logged", r.value?.items.length === r.value?.total && ex1.n === 1, r.error ?? String(ex1.n));

    // ── what browsers may touch ──
    const [p] = await tx.$queryRawUnsafe(`select
      has_table_privilege('authenticated','public."AdminRole"','select') t1, has_table_privilege('anon','public."AdminRole"','select') t2,
      has_table_privilege('authenticated','public."ExamAuditLog"','delete') t3, has_table_privilege('authenticated','public."ExamMember"','update') t4,
      has_function_privilege('anon','public.exam_audit(jsonb)','execute') a1, has_function_privilege('anon','public.exam_role_save(jsonb)','execute') a2,
      has_function_privilege('anon','public.exam_admin_set_role(text,text,text)','execute') a3,
      has_function_privilege('authenticated','public.exam_can(text,text)','execute') h1, has_function_privilege('authenticated','public.exam_require(text,text)','execute') h2,
      has_function_privilege('authenticated','public.exam_staff_course_perm(text)','execute') h3, has_function_privilege('authenticated','public.lms_normalize_permissions(jsonb)','execute') h4,
      (select relrowsecurity from pg_class where oid = 'public."AdminRole"'::regclass) rls,
      (select count(*)::int from pg_proc where pronamespace='public'::regnamespace and proname='exam_admin_set_role') overloads`);
    ok("Browsers have no table access; anonymous callers and helper functions are shut out", !p.t1 && !p.t2 && !p.t3 && !p.t4 && !p.a1 && !p.a2 && !p.a3 && !p.h1 && !p.h2 && !p.h3 && !p.h4 && p.rls, JSON.stringify(p));
    ok("The old two-argument role function is gone", p.overloads === 1, String(p.overloads));
    await as(null);
    r = await j("exam_admin_members", "");
    ok("Signed out: refused", denied(r), r.error ?? "allowed");

    throw ROLLBACK;
  }, { timeout: 240000, maxWait: 30000 });
} catch (e) {
  if (e !== ROLLBACK) results.push({ name: "test run", pass: false, info: e.message });
}
const [after] = await db.$queryRawUnsafe(countSql);
ok("Rollback: members, roles and data are exactly as before", same(before, after), JSON.stringify({ before, after }));
await db.$disconnect();

for (const r of results) console.log(`${r.pass ? "✔" : "✘"} ${r.name}${r.pass ? "" : `  → ${r.info}`}`);
const passed = results.filter((r) => r.pass).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
