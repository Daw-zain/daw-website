// Phase 5 (exam builder) tests — run: node --env-file=.env scripts/test-exams-builder.mjs
// One transaction, rolled back at the end: nothing stays in the database.
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";

const db = new PrismaClient();
const PMP = "cmwx44kbb0001gvkwzr4kyo1l";
const CAPM = "cmwx44lbw0004gvkw5oretlpz";
const results = [];
const ok = (name, pass, info = "") => results.push({ name, pass, info });
const ROLLBACK = new Error("rollback");
const u = (n) => ({ sub: randomUUID(), email: `t-${n}@phase5.test` });
const users = { admin: u("admin"), inst: u("inst"), noSim: u("nosim"), capm: u("capm"), learner: u("learner") };

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
    const j = (fn, ...a) => call(`select public.${fn}(${a.map((_, i) => `$${i + 1}${typeof a[i] === "object" ? "::jsonb" : typeof a[i] === "boolean" ? "::boolean" : ""}`).join(",")})`, ...a.map((x) => (typeof x === "object" ? JSON.stringify(x) : x)));
    const save = (e) => j("exam_exam_save", e);

    // people
    for (const x of Object.values(users)) { await as(x); await call("select public.exam_me()"); }
    await tx.$executeRawUnsafe(`update public."ExamMember" set "role"='ADMIN' where "email"=$1`, users.admin.email);
    await as(users.admin);
    await j("exam_admin_assign_instructor", PMP, users.inst.email, {});
    await j("exam_admin_assign_instructor", PMP, users.noSim.email, { canManageSimulations: false });
    await j("exam_admin_assign_instructor", CAPM, users.capm.email, {});
    await j("exam_admin_enroll", PMP, users.learner.email);

    // bank: D1 10 active TF (5 easy), D2 5 active hard MCQ, 2 drafts in D1, one scenario with 3 questions
    const D1 = (await j("exam_bank_category_save", PMP, { kind: "DOMAIN", nameAr: "مجال 1" })).value.id;
    const D2 = (await j("exam_bank_category_save", PMP, { kind: "DOMAIN", nameAr: "مجال 2" })).value.id;
    const tf = (i, extra = {}) => ({ type: "TRUE_FALSE", stemAr: `سؤال ${i}`, status: "ACTIVE", domainId: D1, difficulty: i < 5 ? "EASY" : "MEDIUM", points: 1, answer: { value: true }, ...extra });
    const d1 = [];
    for (let i = 0; i < 10; i++) d1.push((await j("exam_bank_question_save", PMP, tf(i))).value.id);
    for (let i = 0; i < 5; i++) await j("exam_bank_question_save", PMP, { type: "MCQ", stemAr: `اختيار ${i}`, status: "ACTIVE", domainId: D2, difficulty: "HARD", points: 2, content: { options: [{ id: "a", textAr: "أ" }, { id: "b", textAr: "ب" }] }, answer: { correct: ["a"] } });
    const draft = (await j("exam_bank_question_save", PMP, tf(99, { status: "DRAFT" }))).value.id;
    const S = (await j("exam_bank_scenario_save", PMP, { titleAr: "سيناريو", status: "ACTIVE" })).value.id;
    for (let i = 0; i < 3; i++) await j("exam_bank_question_save", PMP, tf(50 + i, { scenarioId: S, domainId: null }));
    await as(users.capm);
    const capmQ = (await j("exam_bank_question_save", CAPM, { type: "TRUE_FALSE", stemAr: "سؤال CAPM", status: "ACTIVE", answer: { value: true } })).value.id;
    const capmD = (await j("exam_bank_category_save", CAPM, { kind: "DOMAIN", nameAr: "مجال CAPM" })).value.id;

    await as(users.inst);
    const folders = (await j("exam_course_folders", PMP)).value;
    const DOM = folders.find((f) => f.kind === "DOMAIN_TESTS").id;
    const SIM = folders.find((f) => f.kind === "EXAM_SIMULATIONS").id;
    const BANK = folders.find((f) => f.kind === "QUESTION_BANK").id;

    // ── create ──
    const base = { folderId: DOM, titleAr: "اختبار المجال 1", examType: "PRACTICE", durationMinutes: 30, maxAttempts: 2, passPercent: 70, security: { fullscreen: true, maxWarnings: 2, onExceed: "SUBMIT" } };
    let r = await save({ ...base, items: [{ questionId: d1[0] }, { questionId: d1[1], points: "3" }, { questionId: d1[2] }], rules: [{ count: 5, domainId: D1, points: "1", weight: "1" }] });
    const E1 = r.value?.id;
    ok("Instructor creates a draft exam (3 picked + 5 random from Domain 1)", r.value?.status === "DRAFT" && r.value.items.length === 3 && r.value.rules.length === 1, r.error ?? "");
    ok("Readiness check passes: 8 questions, fixed points 1+3+1+5 = 10", r.value?.check?.ok === true && r.value.check.questionCount === 8 && Number(r.value.check.fixedPoints) === 10, JSON.stringify(r.value?.check));
    ok("Security settings normalised", r.value?.security?.onExceed === "SUBMIT" && r.value.security.maxWarnings === 2 && r.value.security.watermark === true, JSON.stringify(r.value?.security));

    for (const [name, e, re] of [
      ["no title", { ...base, titleAr: "" }, /title_missing/],
      ["zero-minute duration", { ...base, durationMinutes: 0 }, /duration/],
      ["pass mark over 100", { ...base, passPercent: 120 }, /pass_percent/],
      ["end before start", { ...base, startsAt: "2027-01-10T10:00:00Z", endsAt: "2027-01-09T10:00:00Z" }, /dates/],
      ["rule count 0", { ...base, rules: [{ count: 0 }] }, /rule_count/],
      ["rule category of another course", { ...base, rules: [{ count: 1, domainId: capmD }] }, /rule_category/],
      ["picked question of another course", { ...base, items: [{ questionId: capmQ }] }, /item_question/],
      ["question-bank folder", { ...base, folderId: BANK }, /invalid_exam: folder/],
    ]) {
      r = await save(e);
      ok(`Exam rejected: ${name}`, re.test(r.error ?? ""), r.error ?? "saved");
    }

    // ── readiness problems ──
    r = await save({ ...base, titleAr: "ناقص", rules: [{ count: 20, domainId: D1 }] });
    ok("Check: rule asks for more questions than exist → rule_short", r.value?.check?.ok === false && r.value.check.issues.some((i) => i.code === "rule_short"), JSON.stringify(r.value?.check?.issues));
    const shortId = r.value?.id;
    r = await save({ ...base, titleAr: "تداخل", rules: [{ count: 8, domainId: D1 }, { count: 8, difficulty: "MEDIUM" }] });
    ok("Check: overlapping rules that cannot both be filled → pool_overlap", r.value?.check?.issues?.some((i) => i.code === "pool_overlap"), JSON.stringify(r.value?.check?.issues));
    r = await save({ ...base, titleAr: "مسودة", items: [{ questionId: draft }] });
    ok("Check: picked draft question → items_inactive", r.value?.check?.issues?.some((i) => i.code === "items_inactive"), JSON.stringify(r.value?.check?.issues));
    r = await j("exam_exam_publish", shortId);
    ok("Publishing an exam that is not ready → refused", /exam_not_ready/.test(r.error), r.error);

    // ── folder permissions ──
    await as(users.noSim);
    r = await save({ ...base, folderId: SIM, titleAr: "محاكاة" });
    ok("Instructor without simulation permission → cannot create in Exam Simulations", /forbidden/.test(r.error), r.error);
    r = await save({ ...base, titleAr: "مجالات" });
    ok("…but can create in Domain Tests", r.value?.status === "DRAFT", r.error ?? "");
    await as(users.capm);
    r = await save({ ...base, titleAr: "x" });
    ok("CAPM instructor → PMP folder refused", /forbidden/.test(r.error), r.error);
    r = await j("exam_exam_get", E1);
    ok("CAPM instructor → PMP exam refused", /forbidden/.test(r.error), r.error);
    await as(users.learner);
    r = await save({ ...base, titleAr: "x" });
    ok("Learner cannot create exams", /forbidden/.test(r.error), r.error);

    // ── publish via approval ──
    await as(users.inst);
    r = await j("exam_exam_publish", E1);
    const [notif] = await tx.$queryRawUnsafe(`select count(*)::int n from public."Notification" where "type"='exam' and "link" like $1`, `%${E1}%`);
    ok("Instructor without publish permission → sent for approval + admin notification", r.value?.status === "PENDING_APPROVAL" && notif.n === 1, r.error ?? `${r.value?.status} notif=${notif.n}`);
    r = await save({ ...base, id: E1, items: [{ questionId: d1[0] }], rules: [{ count: 5, domainId: D1, points: "1", weight: "1" }] });
    ok("Editing a pending exam sends it back to draft (version 2)", r.value?.status === "DRAFT" && r.value.version === 2, `${r.value?.status} v${r.value?.version}`);
    await j("exam_exam_publish", E1);
    r = await j("exam_exam_review", E1, true, "");
    ok("Instructor cannot approve", /forbidden/.test(r.error), r.error);
    await as(users.admin);
    r = await j("exam_exam_review", E1, false, "أضف أسئلة صعبة");
    ok("Admin returns it with a note → draft", r.value?.status === "DRAFT" && r.value.reviewNote === "أضف أسئلة صعبة", r.error ?? "");
    await as(users.inst);
    await j("exam_exam_publish", E1);
    await as(users.admin);
    r = await j("exam_exam_review", E1, true, "");
    ok("Admin approves → published", r.value?.status === "PUBLISHED" && !!r.value.approvedAt, r.error ?? "");

    // ── locked when published; stop / draft / archive / delete ──
    await as(users.inst);
    r = await save({ ...base, id: E1 });
    ok("Published exam cannot be edited", /exam_locked/.test(r.error), r.error);
    r = await j("exam_exam_delete", E1);
    ok("Published exam cannot be deleted", /exam_locked/.test(r.error), r.error);
    r = await j("exam_bank_question_delete", d1[0]);
    ok("A question picked into an exam cannot be deleted", /question_in_exam|forbidden/.test(r.error), r.error);
    await as(users.admin);
    r = await j("exam_bank_question_delete", d1[0]);
    ok("…not even by the admin (question_in_exam)", /question_in_exam/.test(r.error), r.error);
    await as(users.inst);
    r = await j("exam_exam_set_status", E1, "STOPPED");
    ok("Stop a published exam", r.value?.status === "STOPPED", r.error ?? "");
    r = await j("exam_exam_set_status", E1, "PUBLISHED");
    ok("Invalid status jump refused", /invalid_exam: status/.test(r.error), r.error);

    // ── instructor allowed to publish directly ──
    await as(users.admin);
    await j("exam_admin_assign_instructor", PMP, users.inst.email, { canPublishExams: true });
    await as(users.inst);
    r = await j("exam_exam_publish", E1);
    ok("Instructor with publish permission → published directly", r.value?.status === "PUBLISHED", r.error ?? r.value?.status);

    // ── scenario rule + preview ──
    r = await save({ ...base, folderId: SIM, titleAr: "محاكاة شاملة", examType: "SIMULATION", items: [{ questionId: d1[3] }], rules: [{ count: 4, domainId: D2 }, { count: 1, scenarios: true }] });
    const E2 = r.value?.id;
    ok("Simulation with a scenario rule: 1 + 4 + 3 = 8 questions", r.value?.check?.ok && r.value.check.questionCount === 8, JSON.stringify(r.value?.check));
    r = await j("exam_exam_preview", E2);
    const qs = r.value?.questions ?? [];
    const ids = qs.map((q) => q.id);
    const scn = qs.filter((q) => q.scenarioId === S);
    const firstScn = qs.findIndex((q) => q.scenarioId === S);
    ok("Preview draws 8 distinct questions, picked one first", qs.length === 8 && new Set(ids).size === 8 && ids[0] === d1[3], ids.join(","));
    ok("Preview keeps the scenario's 3 questions together and in order", scn.length === 3 && qs.slice(firstScn, firstScn + 3).every((q) => q.scenarioId === S) && scn.map((q) => q.scenarioOrder).join() === "1,2,3", "");
    ok("Random part respects the rule (Domain 2 only)", qs.filter((q) => q.domainId === D2).length === 4, "");

    // ── learner view ──
    await as(users.learner);
    r = await j("exam_folder_exams", DOM);
    const seen = r.value?.exams ?? [];
    ok("Learner sees only published exams of the folder", seen.length === 1 && seen[0].id === E1 && seen.every((e) => e.status === "PUBLISHED"), JSON.stringify(seen.map((e) => e.status)));
    ok("Learner's list carries no questions or rules", seen.every((e) => !("items" in e) && !("rules" in e)) && r.value?.canEdit === false, "");
    r = await j("exam_exam_get", E1);
    ok("Learner cannot open the exam definition", /forbidden/.test(r.error), r.error);
    r = await j("exam_exam_preview", E1);
    ok("Learner cannot run the staff preview", /forbidden/.test(r.error), r.error);
    r = await j("exam_course_folders", PMP);
    ok("Learner folder count = published exams only", r.value?.find((f) => f.kind === "DOMAIN_TESTS")?.count === 1, JSON.stringify(r.value?.map((f) => [f.kind, f.count])));
    await as(users.inst);
    r = await j("exam_course_folders", PMP);
    ok("Staff folder count = all exams in the folder", r.value?.find((f) => f.kind === "DOMAIN_TESTS")?.count >= 5, JSON.stringify(r.value?.map((f) => [f.kind, f.count])));

    // ── archive + delete ──
    r = await j("exam_exam_set_status", E2, "ARCHIVED");
    r = await j("exam_exam_delete", E2);
    ok("Archived exam can be deleted", r.value?.deleted === E2, r.error ?? "");

    throw ROLLBACK;
  }, { timeout: 180000 });
} catch (e) {
  if (e !== ROLLBACK) { console.error("✗ test run failed:", e.message); process.exitCode = 1; }
}

const [left] = await db.$queryRawUnsafe(`select (select count(*)::int from public."ExamMember" where "email" like '%@phase5.test') m, (select count(*)::int from public."Exam") e, (select count(*)::int from public."Question") q, (select count(*)::int from public."Notification" where "type"='exam') n`);
ok("Rollback: no test data left", left.m === 0 && left.e === 0 && left.q === 0 && left.n === 0, JSON.stringify(left));
await db.$disconnect();

for (const t of results) console.log(`${t.pass ? "✔" : "✗"} ${t.name}${t.pass ? "" : `  ← ${t.info}`}`);
const failed = results.filter((t) => !t.pass).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
if (failed) process.exitCode = 1;
