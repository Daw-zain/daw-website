// Question bank: "select all" and bulk actions.
// run: node --env-file=.env scripts/test-exams-bulk.mjs — one transaction, rolled back at the end.
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";

const db = new PrismaClient();
const ROLLBACK = new Error("rollback");
const results = [];
const ok = (name, pass, info = "") => results.push({ name, pass: !!pass, info });
const u = (n) => ({ sub: randomUUID(), email: `t-${n}@bulk.test` });
const users = { admin: u("admin"), inst: u("inst"), noDelete: u("nodelete"), other: u("other"), learner: u("learner") };

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
    const cast = (v) => (v === null ? "::text" : typeof v === "object" ? "::jsonb" : "");
    const j = (fn, ...a) => call(`select public.${fn}(${a.map((v, i) => `$${i + 1}${cast(v)}`).join(",")})`, ...a.map((x) => (typeof x === "object" && x !== null ? JSON.stringify(x) : x)));
    const must = async (fn, ...a) => {
      const r = await j(fn, ...a);
      if (r.error) throw new Error(`${fn}: ${r.error}`);
      return r.value;
    };
    const count = async (where, ...a) => (await tx.$queryRawUnsafe(`select count(*)::int n from public."Question" where ${where}`, ...a))[0].n;

    const empty = await tx.$queryRawUnsafe(`select "id" from public."Program" p where not exists (select 1 from public."Question" q where q."programId"=p."id") order by p."order" limit 2`);
    const [COURSE, OTHER] = empty.map((r) => r.id);
    const everyone = await count(`true`);

    for (const x of Object.values(users)) { await as(x); await must("exam_me"); }
    await tx.$executeRawUnsafe(`update public."ExamMember" set "role"='ADMIN' where "email"=$1`, users.admin.email);
    await as(users.admin);
    await must("exam_admin_assign_instructor", COURSE, users.inst.email, { canDeleteQuestions: true, canPublishExams: true });
    await must("exam_admin_assign_instructor", COURSE, users.noDelete.email, { canDeleteQuestions: false });
    await must("exam_admin_assign_instructor", OTHER, users.other.email, { canDeleteQuestions: true });
    await must("exam_admin_enroll", COURSE, users.learner.email);

    // a question of another course
    await as(users.other);
    const foreign = (await must("exam_bank_question_save", OTHER, { type: "TRUE_FALSE", stemAr: "دورة أخرى", status: "ACTIVE", answer: { value: true } })).id;

    await as(users.inst);
    const D = (await must("exam_bank_category_save", COURSE, { kind: "DOMAIN", nameAr: "مجال" })).id;
    const T = (await must("exam_bank_category_save", COURSE, { kind: "TOPIC", parentId: D, nameAr: "موضوع" })).id;
    const ids = [];
    for (let i = 0; i < 30; i++)
      ids.push((await must("exam_bank_question_save", COURSE, { type: "TRUE_FALSE", stemAr: `سؤال رقم ${i}`, status: "DRAFT", difficulty: i < 10 ? "EASY" : "HARD", answer: { value: i % 2 === 0 } })).id);
    const hot = (await must("exam_bank_question_save", COURSE, { type: "HOTSPOT", stemAr: "منطقة بلا صورة", status: "DRAFT", content: {}, answer: {} })).id;

    // ── select all ──
    let r = await j("exam_bank_question_ids", COURSE, {});
    ok("Select all: every question of the course, beyond one page", r.value?.total === 31 && r.value.ids.length === 31 && !r.value.ids.includes(foreign), r.error ?? String(r.value?.total));
    r = await j("exam_bank_question_ids", COURSE, { difficulty: "EASY", page: 3 });
    ok("Select all follows the filter and ignores the page number", r.value?.total === 10 && r.value.ids.length === 10, r.error ?? String(r.value?.total));
    r = await j("exam_bank_question_ids", COURSE, { q: "رقم 2" });
    const list = await must("exam_bank_questions", COURSE, { q: "رقم 2", pageSize: 100 });
    ok("…and returns exactly what the list shows for the same search", r.value?.total === list.total && list.total === 11 && list.items.every((x) => r.value.ids.includes(x.id)), JSON.stringify([r.value?.total, list.total]));
    r = await j("exam_bank_questions", COURSE, { pageSize: 20, page: 2 });
    ok("The list still pages as before", r.value?.total === 31 && r.value.items.length === 11, r.error ?? "");

    // ── status ──
    const all = (await must("exam_bank_question_ids", COURSE, {})).ids;
    r = await j("exam_bank_question_bulk", COURSE, "status", all, { status: "ACTIVE" });
    ok("Activate all: 30 activated, the incomplete hotspot is refused with its reason", r.value?.done === 30 && r.value.failed.length === 1 && r.value.failed[0].id === hot && /hotspot_image_missing/.test(r.value.failed[0].reason), r.error ?? JSON.stringify(r.value));
    r = await j("exam_bank_question_bulk", COURSE, "status", ids, { status: "ACTIVE" });
    ok("Repeating it changes nothing (already in that status)", r.value?.done === 0 && r.value.unchanged === 30, JSON.stringify(r.value));
    r = await j("exam_bank_question_bulk", COURSE, "status", ids.slice(0, 3), { status: "DISABLED" });
    ok("Disable a selection", r.value?.done === 3 && (await count(`"programId"=$1 and "status"='DISABLED'`, COURSE)) === 3, JSON.stringify(r.value));

    // ── difficulty / category keep versions ──
    r = await j("exam_bank_question_bulk", COURSE, "difficulty", ids.slice(5, 15), { difficulty: "MEDIUM" });
    ok("Change difficulty of a selection", r.value?.done === 10 && (await count(`"programId"=$1 and "difficulty"='MEDIUM' and "type"='TRUE_FALSE'`, COURSE)) === 10, JSON.stringify(r.value));
    const [v] = await tx.$queryRawUnsafe(`select q."version", (select count(*)::int from public."QuestionVersion" x where x."questionId"=q."id") n, q."status", s."answer" from public."Question" q join public."QuestionSecret" s on s."questionId"=q."id" where q."id"=$1`, ids[5]);
    ok("…recorded as a new version; status and answer untouched", v.version === 2 && v.n === 2 && v.status === "ACTIVE" && v.answer.value === false, JSON.stringify(v));
    r = await j("exam_bank_question_bulk", COURSE, "category", ids.slice(0, 4), { categoryId: T });
    ok("Move to a topic fills in its domain", r.value?.done === 4 && (await count(`"programId"=$1 and "topicId"=$2 and "domainId"=$3`, COURSE, T, D)) === 4, JSON.stringify(r.value));
    r = await j("exam_bank_question_bulk", COURSE, "category", ids.slice(0, 2), { categoryId: "" });
    ok("Remove the category", r.value?.done === 2 && (await count(`"programId"=$1 and "domainId" is null and "id" = any($2::text[])`, COURSE, ids.slice(0, 2))) === 2, JSON.stringify(r.value));

    // ── copy ──
    r = await j("exam_bank_question_bulk", COURSE, "copy", ids.slice(10, 15), {});
    ok("Copy a selection: 5 new drafts", r.value?.done === 5 && (await count(`"programId"=$1`, COURSE)) === 36 && (await count(`"programId"=$1 and "status"='DRAFT' and "type"='TRUE_FALSE'`, COURSE)) === 5, JSON.stringify(r.value));

    // ── delete: questions in use are protected ──
    const DOM = (await must("exam_course_folders", COURSE)).find((f) => f.kind === "DOMAIN_TESTS").id;
    const ex = (await must("exam_exam_save", { folderId: DOM, titleAr: "اختبار", durationMinutes: 10, items: [{ questionId: ids[20] }, { questionId: ids[21] }] })).id;
    r = await j("exam_bank_question_bulk", COURSE, "delete", ids.slice(18, 24), {});
    ok("Delete a selection: questions used in a test are kept and reported", r.value?.done === 4 && r.value.failed.length === 2 && r.value.failed.every((f) => /question_in_exam/.test(f.reason) && f.stemAr) && (await count(`"id" = any($1::text[])`, ids.slice(18, 24))) === 2 && !!ex, JSON.stringify(r.value));

    // ── isolation and limits ──
    r = await j("exam_bank_question_bulk", COURSE, "delete", [foreign, "nope"], {});
    ok("Ids of another course are not touched", r.value?.done === 0 && r.value.failed.length === 2 && r.value.failed.every((f) => /not_found/.test(f.reason) && f.stemAr === null) && (await count(`"id"=$1`, foreign)) === 1, JSON.stringify(r.value));
    r = await j("exam_bank_question_bulk", COURSE, "copy", Array.from({ length: 101 }, (_, i) => `x${i}`), {});
    ok("More than 100 ids in one request refused", /max_100/.test(r.error ?? ""), r.error ?? "");
    r = await j("exam_bank_question_bulk", COURSE, "publish", ids, {});
    ok("Unknown action refused", /action/.test(r.error ?? ""), r.error ?? "");
    r = await j("exam_bank_question_bulk", COURSE, "status", ids, { status: "X" });
    ok("Unknown status refused before anything changes", /status/.test(r.error ?? ""), r.error ?? "");
    r = await j("exam_bank_question_bulk", COURSE, "category", ids, { categoryId: "nope" });
    ok("Unknown category refused", /not_found/.test(r.error ?? ""), r.error ?? "");

    // ── permissions ──
    const before = await count(`"programId"=$1`, COURSE);
    await as(users.noDelete);
    r = await j("exam_bank_question_bulk", COURSE, "delete", ids.slice(0, 2), {});
    ok("Without the delete permission bulk delete is refused entirely", /forbidden/.test(r.error ?? "") && (await count(`"programId"=$1`, COURSE)) === before, r.error ?? "");
    r = await j("exam_bank_question_bulk", COURSE, "difficulty", ids.slice(0, 2), { difficulty: "HARD" });
    ok("…while edit actions still work for that instructor", !r.error, r.error ?? "");
    for (const [who, label] of [[users.learner, "A learner"], [users.other, "An instructor of another course"]]) {
      await as(who);
      const a = await j("exam_bank_question_ids", COURSE, {});
      const c = await j("exam_bank_question_bulk", COURSE, "copy", ids.slice(0, 2), {});
      ok(`${label} can neither select nor act`, /forbidden/.test(a.error ?? "") && /forbidden/.test(c.error ?? ""), `${a.error} | ${c.error}`);
    }
    await as(null);
    r = await j("exam_bank_question_ids", COURSE, {});
    ok("Signed out: refused", /forbidden/.test(r.error ?? ""), r.error ?? "");

    const [p] = await tx.$queryRawUnsafe(`select has_function_privilege('anon','public.exam_bank_question_bulk(text,text,jsonb,jsonb)','execute') a,
      has_function_privilege('anon','public.exam_bank_question_ids(text,jsonb)','execute') b,
      has_function_privilege('authenticated','public.exam_bank_match(text,jsonb)','execute') c`);
    ok("anon cannot execute them; the shared filter helper is internal", !p.a && !p.b && !p.c, JSON.stringify(p));
    const [log] = await tx.$queryRawUnsafe(`select count(*)::int n from public."ExamAuditLog" where "action"='question.bulk' and "programId"=$1`, COURSE);
    ok("Every bulk action is written to the audit log", log.n >= 6, String(log.n));
    ok("No other course's questions changed in number", (await count(`"programId" not in ($1,$2)`, COURSE, OTHER)) === everyone, "");

    throw ROLLBACK;
  }, { timeout: 240000, maxWait: 20000 });
} catch (e) {
  if (e !== ROLLBACK) results.push({ name: "test run", pass: false, info: e.message });
} finally {
  await db.$disconnect();
}

for (const r of results) console.log(`${r.pass ? "✔" : "✘"} ${r.name}${r.pass ? "" : `  → ${r.info}`}`);
const passed = results.filter((r) => r.pass).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
