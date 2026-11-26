// Phase 3 (question bank) tests — run: node --env-file=.env scripts/test-exams-bank.mjs
// One transaction, rolled back at the end: nothing stays in the database.
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";

const db = new PrismaClient();
const PMP = "cmwx44kbb0001gvkwzr4kyo1l";
const CAPM = "cmwx44lbw0004gvkw5oretlpz";
const results = [];
const ok = (name, pass, info = "") => results.push({ name, pass, info });
const ROLLBACK = new Error("rollback");
const u = (n) => ({ sub: randomUUID(), email: `t-${n}@phase3.test` });
const users = { admin: u("admin"), inst: u("inst"), viewer: u("viewer"), capm: u("capm"), learner: u("learner") };

const opts = (...t) => t.map((x, i) => ({ id: `o${i + 1}`, textAr: x, textEn: "" }));
const VALID = {
  MCQ: { content: { options: opts("أ", "ب", "ج", "د") }, answer: { correct: ["o2"] } },
  MULTI: { content: { options: opts("أ", "ب", "ج", "د") }, answer: { correct: ["o1", "o3"] }, scoring: { mode: "PARTIAL" } },
  TRUE_FALSE: { answer: { value: true } },
  NUMERIC: { content: { unitAr: "يوم" }, answer: { value: 12.5, tolerance: 0.5 } },
  SHORT: { answer: { accepted: ["WBS", "هيكل تجزئة العمل"], caseSensitive: false } },
  ESSAY: { content: { minWords: 50, maxWords: 300 }, answer: { rubricAr: "يذكر ثلاث نقاط" } },
  ORDERING: { content: { items: opts("بدء", "تخطيط", "تنفيذ") }, answer: { order: ["o1", "o2", "o3"] } },
  MATCHING: { content: { left: opts("CPI", "SPI"), right: opts("كلفة", "جدول", "مخاطر") }, answer: { pairs: { o1: "o1", o2: "o2" } } },
};

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
    const save = (program, q) => call("select public.exam_bank_question_save($1, $2::jsonb)", program, JSON.stringify(q));
    const catSave = (program, c) => call("select public.exam_bank_category_save($1, $2::jsonb)", program, JSON.stringify(c));

    // members + roles
    for (const x of Object.values(users)) { await as(x); await call("select public.exam_me()"); }
    await tx.$executeRawUnsafe(`update public."ExamMember" set "role"='ADMIN' where "email"=$1`, users.admin.email);
    await as(users.admin);
    await call("select public.exam_admin_assign_instructor($1,$2,'{}'::jsonb)", PMP, users.inst.email); // defaults: edit yes, delete no, categories yes
    await call("select public.exam_admin_assign_instructor($1,$2,$3::jsonb)", PMP, users.viewer.email, JSON.stringify({ canEditQuestions: false, canManageCategories: false }));
    await call("select public.exam_admin_assign_instructor($1,$2,'{}'::jsonb)", CAPM, users.capm.email);
    await call("select public.exam_admin_enroll($1,$2)", PMP, users.learner.email);

    // ── categories ──
    let r = await catSave(PMP, { kind: "DOMAIN", nameAr: "الأشخاص", nameEn: "People" });
    const D1 = r.value?.id;
    ok("Admin creates a domain", !!D1, r.error ?? "");
    r = await catSave(PMP, { kind: "TOPIC", parentId: D1, nameAr: "إدارة الصراع" });
    const T1 = r.value?.id;
    r = await catSave(PMP, { kind: "SUBTOPIC", parentId: T1, nameAr: "أساليب التفاوض" });
    const S1 = r.value?.id;
    ok("Topic under domain, subtopic under topic", !!T1 && !!S1, r.error ?? "");
    r = await catSave(PMP, { kind: "SUBTOPIC", parentId: D1, nameAr: "x" });
    ok("Subtopic directly under a domain → refused", /wrong_parent/.test(r.error), r.error);
    r = await catSave(PMP, { kind: "TOPIC", nameAr: "x" });
    ok("Topic without parent → refused", /parent_missing/.test(r.error), r.error);
    await as(users.capm);
    r = await catSave(CAPM, { kind: "DOMAIN", nameAr: "مجال CAPM" });
    const CAPM_D = r.value?.id;
    r = await catSave(PMP, { kind: "TOPIC", parentId: CAPM_D, nameAr: "x" });
    ok("CAPM instructor → PMP categories refused", /forbidden/.test(r.error), r.error);
    await as(users.inst);
    r = await catSave(PMP, { kind: "TOPIC", parentId: CAPM_D, nameAr: "x" });
    ok("Parent from another course → refused", /parent_missing/.test(r.error), r.error);
    r = await catSave(PMP, { kind: "DOMAIN", nameAr: "العمليات" });
    const D2 = r.value?.id;
    ok("Instructor with category permission creates a domain", !!D2, r.error ?? "");
    await as(users.viewer);
    r = await catSave(PMP, { kind: "DOMAIN", nameAr: "x" });
    ok("Instructor without category permission → refused", /forbidden/.test(r.error), r.error);

    // ── questions: every supported type ──
    await as(users.inst);
    const ids = {};
    for (const [type, parts] of Object.entries(VALID)) {
      r = await save(PMP, { type, stemAr: `سؤال ${type}`, status: "ACTIVE", difficulty: "MEDIUM", points: 2, weight: 1.5, domainId: D1, keywords: ["test", type], feedbackAr: "تغذية", explanationAr: "شرح", ...parts });
      ids[type] = r.value?.id;
      ok(`Save ${type} question (version 1)`, !!r.value?.id && r.value.version === 1, r.error ?? "");
    }
    r = await call(`select count(*)::int from public."QuestionVersion" where "questionId" = any($1::text[])`, Object.values(ids));
    ok("A version snapshot exists for every saved question", r.value === 8, String(r.value));

    // ── validation ──
    const bad = [
      ["MCQ with two correct answers", { type: "MCQ", content: VALID.MCQ.content, answer: { correct: ["o1", "o2"] } }, /mcq_one_correct/],
      ["MCQ correct answer not among options", { type: "MCQ", content: VALID.MCQ.content, answer: { correct: ["zz"] } }, /correct_unknown_option/],
      ["MCQ with one option", { type: "MCQ", content: { options: opts("أ") }, answer: { correct: ["o1"] } }, /options_min_2/],
      ["MULTI with every option correct", { type: "MULTI", content: VALID.MCQ.content, answer: { correct: ["o1", "o2", "o3", "o4"] } }, /multi_not_all_correct/],
      ["TRUE_FALSE without value", { type: "TRUE_FALSE", answer: {} }, /tf_value_missing/],
      ["NUMERIC without value", { type: "NUMERIC", answer: { tolerance: 1 } }, /numeric_value_missing/],
      ["SHORT without accepted answers", { type: "SHORT", answer: { accepted: ["  "] } }, /short_accepted_missing/],
      ["ESSAY min > max words", { type: "ESSAY", content: { minWords: 300, maxWords: 50 } }, /essay_word_limits/],
      ["ORDERING not a permutation", { type: "ORDERING", content: VALID.ORDERING.content, answer: { order: ["o1", "o1", "o3"] } }, /order_not_permutation/],
      ["MATCHING incomplete pairs", { type: "MATCHING", content: VALID.MATCHING.content, answer: { pairs: { o1: "o1" } } }, /pairs_incomplete/],
      ["MATCHING two lefts to one right", { type: "MATCHING", content: VALID.MATCHING.content, answer: { pairs: { o1: "o1", o2: "o1" } } }, /pairs_duplicate_right/],
      ["Unknown type", { type: "HOTSPOT_X", answer: {} }, /unknown_type/],
      ["Empty stem", { type: "TRUE_FALSE", stemAr: " ", answer: { value: true } }, /stem_missing/],
      ["Invalid points", { type: "TRUE_FALSE", points: "-3", answer: { value: true } }, /points/],
      ["Option with empty text", { type: "MCQ", content: { options: [{ id: "a", textAr: "" }, { id: "b", textAr: "ب" }] }, answer: { correct: ["b"] } }, /options_empty_text/],
    ];
    for (const [name, q, re] of bad) {
      r = await save(PMP, { stemAr: "نص", ...q });
      ok(`Rejected: ${name}`, re.test(r.error ?? ""), r.error ?? `saved ${JSON.stringify(r.value)?.slice(0, 80)}`);
    }

    // ── categories on questions ──
    r = await save(PMP, { type: "TRUE_FALSE", stemAr: "تصنيف تلقائي", subtopicId: S1, answer: { value: false } });
    ok("Choosing a subtopic fills topic and domain", r.value?.topicId === T1 && r.value?.domainId === D1, JSON.stringify({ d: r.value?.domainId, t: r.value?.topicId }));
    r = await save(PMP, { type: "TRUE_FALSE", stemAr: "x", domainId: CAPM_D, answer: { value: true } });
    ok("Category of another course on a PMP question → refused", /invalid_question: domain/.test(r.error), r.error);

    // ── update → version 2 ──
    r = await save(PMP, { id: ids.MCQ, type: "MCQ", stemAr: "سؤال MCQ معدل", ...VALID.MCQ, answer: { correct: ["o3"] } });
    const [vc] = await tx.$queryRawUnsafe(`select count(*)::int n from public."QuestionVersion" where "questionId"=$1`, ids.MCQ);
    const [v1] = await tx.$queryRawUnsafe(`select "snapshot"->'answer'->'correct' c from public."QuestionVersion" where "questionId"=$1 and "version"=1`, ids.MCQ);
    ok("Edit → version 2, old snapshot keeps the old answer", r.value?.version === 2 && vc.n === 2 && JSON.stringify(v1.c) === '["o2"]', JSON.stringify({ v: r.value?.version, n: vc.n, old: v1.c }));

    // ── reading ──
    r = await call("select public.exam_bank_questions($1, $2::jsonb)", PMP, JSON.stringify({ type: "MCQ" }));
    ok("List filtered by type", r.value?.total === 1, JSON.stringify(r.value?.total));
    ok("List items carry no answer / feedback / explanation", r.value?.items?.every((i) => !("answer" in i) && !("feedbackAr" in i) && !("explanationAr" in i)), "");
    r = await call("select public.exam_bank_questions($1, $2::jsonb)", PMP, JSON.stringify({ q: "NUMERIC" }));
    ok("Search matches keywords", r.value?.total === 1, JSON.stringify(r.value?.total));
    r = await call("select public.exam_bank_questions($1, $2::jsonb)", PMP, JSON.stringify({ categoryId: T1 }));
    ok("Filter by topic", r.value?.total === 1, JSON.stringify(r.value?.total));
    r = await call("select public.exam_bank_question($1)", ids.MATCHING);
    ok("Editor view returns the answer + explanation to staff", r.value?.answer?.pairs?.o2 === "o2" && r.value?.explanationAr === "شرح", "");
    r = await call("select public.exam_bank_overview($1)", PMP);
    ok("Overview: counts + effective permissions", r.value?.counts?.total === 9 && r.value?.can?.edit === true && r.value?.can?.delete === false, JSON.stringify(r.value?.can));

    // ── who is refused ──
    await as(users.viewer);
    r = await call("select public.exam_bank_question($1)", ids.MCQ);
    ok("View-only instructor can read the bank", r.value?.id === ids.MCQ, r.error ?? "");
    r = await save(PMP, { type: "TRUE_FALSE", stemAr: "x", answer: { value: true } });
    ok("Instructor without edit permission → save refused", /forbidden/.test(r.error), r.error);
    await as(users.capm);
    r = await call("select public.exam_bank_question($1)", ids.MCQ);
    ok("CAPM instructor → PMP question refused", /forbidden/.test(r.error), r.error);
    r = await call("select public.exam_bank_questions($1, '{}'::jsonb)", PMP);
    ok("CAPM instructor → PMP list refused", /forbidden/.test(r.error), r.error);
    await as(users.learner);
    for (const [name, sql, arg] of [
      ["overview", "select public.exam_bank_overview($1)", PMP],
      ["list", "select public.exam_bank_questions($1, '{}'::jsonb)", PMP],
      ["question by id", "select public.exam_bank_question($1)", ids.MCQ],
    ]) {
      r = await call(sql, arg);
      ok(`Enrolled learner → bank ${name} refused`, /forbidden/.test(r.error), r.error);
    }
    r = await call("select public.exam_course_folders($1)", PMP);
    ok("Learner folders: no bank, no question count", r.value?.length === 4 && r.value.every((f) => f.kind !== "QUESTION_BANK" && f.count == null), "");
    await as(users.inst);
    r = await call("select public.exam_course_folders($1)", PMP);
    ok("Staff folders: bank shows question count", r.value?.find((f) => f.kind === "QUESTION_BANK")?.count === 9, JSON.stringify(r.value?.find((f) => f.kind === "QUESTION_BANK")));

    // ── copy / status / delete ──
    r = await call("select public.exam_bank_question_copy($1)", ids.SHORT);
    ok("Copy → new draft in the same course with the answer", r.value?.id && r.value.id !== ids.SHORT && r.value.status === "DRAFT" && r.value.answer?.accepted?.length === 2, r.error ?? "");
    r = await call("select public.exam_bank_question_set_status($1, 'DISABLED')", ids.ESSAY);
    ok("Disable a question", r.value?.status === "DISABLED", r.error ?? "");
    r = await call("select public.exam_bank_question_delete($1)", ids.ESSAY);
    ok("Instructor without delete permission → delete refused", /forbidden/.test(r.error), r.error);
    await as(users.admin);
    r = await call("select public.exam_bank_question_delete($1)", ids.ESSAY);
    const [gone] = await tx.$queryRawUnsafe(`select (select count(*)::int from public."QuestionSecret" where "questionId"=$1) s, (select count(*)::int from public."QuestionVersion" where "questionId"=$1) v`, ids.ESSAY);
    ok("Admin deletes a question (secret + versions removed with it)", r.value?.deleted === ids.ESSAY && gone.s === 0 && gone.v === 0, JSON.stringify(gone));
    r = await call("select public.exam_bank_category_delete($1)", D1);
    ok("Delete a category that has questions/children → refused", /category_in_use/.test(r.error), r.error);
    r = await call("select public.exam_bank_category_delete($1)", D2);
    ok("Delete an empty category", r.value?.deleted === D2, r.error ?? "");

    throw ROLLBACK;
  }, { timeout: 120000 });
} catch (e) {
  if (e !== ROLLBACK) { console.error("✗ test run failed:", e.message); process.exitCode = 1; }
}

const [left] = await db.$queryRawUnsafe(`select (select count(*)::int from public."ExamMember" where "email" like '%@phase3.test') m, (select count(*)::int from public."Question") q, (select count(*)::int from public."QuestionCategory") c`);
ok("Rollback: no test data left (members, questions, categories)", left.m === 0 && left.q === 0 && left.c === 0, JSON.stringify(left));
await db.$disconnect();

for (const t of results) console.log(`${t.pass ? "✔" : "✗"} ${t.name}${t.pass ? "" : `  ← ${t.info}`}`);
const failed = results.filter((t) => !t.pass).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
if (failed) process.exitCode = 1;
