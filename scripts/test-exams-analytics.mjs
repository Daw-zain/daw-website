// Phase 12 (reports and analytics) tests — every expected number is worked out by hand in the comments.
// run: node --env-file=.env scripts/test-exams-analytics.mjs — one transaction, rolled back at the end.
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";

const db = new PrismaClient();
const ROLLBACK = new Error("rollback");
const results = [];
const ok = (name, pass, info = "") => results.push({ name, pass: !!pass, info });
const u = (n) => ({ sub: randomUUID(), email: `t-${n}@phase12.test` });
const users = { admin: u("admin"), inst: u("inst"), noResults: u("noresults"), other: u("other"), l1: u("l1"), l2: u("l2"), l3: u("l3"), l4: u("l4") };
const crowd = Array.from({ length: 10 }, (_, i) => u(`c${i}`));
const num = (v) => (v === null || v === undefined ? v : Number(v));

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
    const cast = (v) => (v === null ? "::text" : typeof v === "object" ? "::jsonb" : typeof v === "boolean" ? "::boolean" : typeof v === "number" ? (Number.isInteger(v) ? "::int" : "::numeric") : "");
    const j = (fn, ...a) => call(`select public.${fn}(${a.map((v, i) => `$${i + 1}${cast(v)}`).join(",")})`, ...a.map((x) => (typeof x === "object" && x !== null ? JSON.stringify(x) : x)));
    const must = async (fn, ...a) => {
      const r = await j(fn, ...a);
      if (r.error) throw new Error(`${fn}: ${r.error}`);
      return r.value;
    };
    const aq = async (attempt, question) => (await call(`select "id" from public."AttemptQuestion" where "attemptId"=$1 and "questionId"=$2`, attempt, question)).value;
    // start an attempt, answer {questionId: response}, submit
    const take = async (who, exam, answers, submit = true) => {
      await as(who);
      const id = (await must("exam_attempt_start", exam)).attemptId;
      for (const [q, resp] of Object.entries(answers)) await must("exam_attempt_save", id, await aq(id, q), resp, false);
      if (submit) await must("exam_attempt_submit", id);
      return id;
    };

    const [{ id: COURSE }] = await tx.$queryRawUnsafe(`select "id" from public."Program" p where not exists (select 1 from public."ExamAttempt" a where a."programId"=p."id") and not exists (select 1 from public."Question" q where q."programId"=p."id") order by p."order" limit 1`);
    const [{ id: OTHER }] = await tx.$queryRawUnsafe(`select "id" from public."Program" where "id" <> $1 order by "order" desc limit 1`, COURSE);

    for (const x of [...Object.values(users), ...crowd]) { await as(x); await must("exam_me"); }
    await tx.$executeRawUnsafe(`update public."ExamMember" set "role"='ADMIN' where "email"=$1`, users.admin.email);
    await as(users.admin);
    await must("exam_admin_assign_instructor", COURSE, users.inst.email, { canPublishExams: true, canReviewEssays: true, canViewResults: true });
    await must("exam_admin_assign_instructor", COURSE, users.noResults.email, { canViewResults: false });
    await must("exam_admin_assign_instructor", OTHER, users.other.email, {});
    for (const x of [users.l1, users.l2, users.l3, users.l4, ...crowd]) await must("exam_admin_enroll", COURSE, x.email);

    await as(users.inst);
    const D1 = (await must("exam_bank_category_save", COURSE, { kind: "DOMAIN", nameAr: "المجال الأول", nameEn: "Domain one" })).id;
    const D2 = (await must("exam_bank_category_save", COURSE, { kind: "DOMAIN", nameAr: "المجال الثاني" })).id;
    const o = (...t) => t.map((x, i) => ({ id: `o${i + 1}`, textAr: x }));
    const save = async (d) => (await must("exam_bank_question_save", COURSE, { status: "ACTIVE", points: 1, ...d })).id;
    const qMCQ = await save({ type: "MCQ", stemAr: "اختر الصحيح", domainId: D1, difficulty: "HARD", content: { options: o("أ", "ب", "ج") }, answer: { correct: ["o2"] } });
    const qNUM = await save({ type: "NUMERIC", stemAr: "كم", domainId: D1, difficulty: "MEDIUM", answer: { value: 10, tolerance: 0 } });
    const qTF = await save({ type: "TRUE_FALSE", stemAr: "صح أم خطأ", domainId: D2, difficulty: "EASY", answer: { value: true } });
    const qSH = await save({ type: "SHORT", stemAr: "اكتب", difficulty: "EASY", answer: { accepted: ["خطر"] } });
    const qES = await save({ type: "ESSAY", stemAr: "مقال", points: 4, content: { maxWords: 100 }, answer: { rubricAr: "دليل" } });
    const qA = await save({ type: "TRUE_FALSE", stemAr: "تمييز أ", answer: { value: true } });
    const qB = await save({ type: "TRUE_FALSE", stemAr: "تمييز ب", answer: { value: true } });
    const DOM = (await must("exam_course_folders", COURSE)).find((f) => f.kind === "DOMAIN_TESTS").id;
    const mk = async (title, items, extra = {}) => {
      const r = await must("exam_exam_save", { folderId: DOM, titleAr: title, durationMinutes: 30, maxAttempts: 5, passPercent: 50, items: items.map((questionId) => ({ questionId })), ...extra });
      return (await must("exam_exam_publish", r.id)).id;
    };
    const E1 = await mk("الاختبار الأول", [qMCQ, qNUM, qTF, qSH]);
    const EH = await mk("نتيجة يدوية", [qTF], { resultsPolicy: "MANUAL" });
    const EE = await mk("مقالي", [qES]);
    const ED = await mk("تمييز", [qA, qB]);

    // ── before any attempt ──
    let r = await j("exam_analytics_course", COURSE, {});
    ok("Empty course: zero counts and no averages (nothing invented)", r.value?.summary?.attempts === 0 && r.value.summary.counted === 0 && r.value.summary.avgPercent === null && r.value.summary.passRate === null && r.value.questions.length === 0 && r.value.exams.length === 0, r.error ?? JSON.stringify(r.value?.summary));

    // l1: 25 % then 100 % ; l2: 50 % ; l1 hidden exam: 0 % ; l2 essay pending ; l3 in progress
    const a11 = await take(users.l1, E1, { [qMCQ]: { choice: "o1" }, [qNUM]: { value: 3 }, [qTF]: { value: true } });
    const a12 = await take(users.l1, E1, { [qMCQ]: { choice: "o2" }, [qNUM]: { value: 10 }, [qTF]: { value: true }, [qSH]: { text: "خطر" } });
    const a2 = await take(users.l2, E1, { [qMCQ]: { choice: "o2" }, [qNUM]: { value: 10 }, [qTF]: { value: false }, [qSH]: { text: "فرصة" } });
    const a1h = await take(users.l1, EH, { [qTF]: { value: false } });
    const a2e = await take(users.l2, EE, { [qES]: { text: "إجابة" } });
    const a3 = await take(users.l3, E1, { [qMCQ]: { choice: "o3" } }, false);
    await must("exam_attempt_event", a3, "BLUR", "x");

    await as(users.inst);
    r = await j("exam_analytics_course", COURSE, {});
    let d = r.value;
    const s = d?.summary ?? {};
    ok("Counts: 6 attempts, 4 counted, 1 in progress, 1 awaiting grading, 3 learners", s.attempts === 6 && s.counted === 4 && s.inProgress === 1 && s.pendingGrading === 1 && s.learners === 3, r.error ?? JSON.stringify(s));
    ok("Average of 25, 100, 50, 0 = 43.8; median 37.5; min 0; max 100", num(s.avgPercent) === 43.8 && num(s.medianPercent) === 37.5 && num(s.minPercent) === 0 && num(s.maxPercent) === 100, JSON.stringify(s));
    ok("Pass rate 2 of 4 = 50 %", s.passed === 2 && s.graded === 4 && num(s.passRate) === 50, JSON.stringify(s));
    const dist = d.distribution.map((b) => b.count).join(",");
    ok("Distribution: one each in 0, 20, 50 and 90–100", dist === "1,0,1,0,0,1,0,0,0,1", dist);
    ok("Trend has one day with 4 attempts", d.trend.unit === "day" && d.trend.points.length === 1 && d.trend.points[0].attempts === 4, JSON.stringify(d.trend));

    // domain 1: qMCQ + qNUM over 3 E1 attempts = 6 asked, 4 correct ; domain 2: qTF 3 × E1 + EH = 4 asked, 2 correct
    const dom = (id) => d.domains.find((x) => x.key === id);
    ok("Domain 1: 6 asked, 4 correct, 66.7 %", dom(D1)?.asked === 6 && dom(D1).correct === 4 && num(dom(D1).scorePct) === 66.7 && dom(D1).nameEn === "Domain one", JSON.stringify(dom(D1)));
    ok("Domain 2: 4 asked, 2 correct, 50 %", dom(D2)?.asked === 4 && dom(D2).correct === 2 && num(dom(D2).scorePct) === 50, JSON.stringify(dom(D2)));
    const none = d.domains.find((x) => x.key === null);
    ok("Questions without a domain are grouped separately (short answer: 3 asked, 2 answered, 1 correct)", none?.asked === 3 && none.answered === 2 && none.correct === 1, JSON.stringify(none));
    const typ = d.types.find((x) => x.key === "MCQ");
    ok("By type: MCQ 3 asked, 2 correct", typ?.asked === 3 && typ.correct === 2, JSON.stringify(d.types));
    const easy = d.difficulties.find((x) => x.key === "EASY");
    ok("By difficulty: EASY = qTF (4) + qSH (3) = 7 asked, 3 correct", easy?.asked === 7 && easy.correct === 3, JSON.stringify(d.difficulties));

    const qm = d.questions.find((x) => x.questionId === qMCQ);
    ok("Item analysis MCQ: asked 3, correct 2, wrong 1, facility 66.7", qm?.asked === 3 && qm.correct === 2 && qm.wrong === 1 && num(qm.facility) === 66.7, JSON.stringify(qm));
    const qs = d.questions.find((x) => x.questionId === qSH);
    ok("Unanswered is separate from wrong (short answer: 1 unanswered, 1 wrong)", qs?.unanswered === 1 && qs.wrong === 1, JSON.stringify(qs));
    ok("Discrimination is withheld below 10 answer sheets", d.questions.every((x) => x.discrimination === null), "");
    ok("Questions are ordered from hardest to easiest", d.questions.every((x, i) => i === 0 || num(d.questions[i - 1].facility) <= num(x.facility)), d.questions.map((x) => x.facility).join(","));

    const ex = d.exams.find((x) => x.examId === E1);
    ok("Exam analysis E1: 4 attempts, 3 counted, 3 learners, avg 58.3, pass 66.7", ex?.attempts === 4 && ex.counted === 3 && ex.learners === 3 && num(ex.avgPercent) === 58.3 && num(ex.passRate) === 66.7 && num(ex.minPercent) === 25 && num(ex.maxPercent) === 100, JSON.stringify(ex));
    const im = d.improvement;
    ok("Improvement: one learner/exam pair, 25 → 100 (+75)", im.pairs === 1 && im.improved === 1 && im.declined === 0 && num(im.avgChange) === 75 && num(im.rows[0].first) === 25 && num(im.rows[0].last) === 100, JSON.stringify(im));
    const le = d.learners.find((x) => x.email === users.l1.email);
    ok("Learner row l1: 3 attempts, avg 41.7, best 100, passed 1 of 2 exams", le?.attempts === 3 && le.counted === 3 && num(le.avgPercent) === 41.7 && num(le.bestPercent) === 100 && le.exams === 2 && le.examsPassed === 1, JSON.stringify(le));
    const row = d.attemptsList.find((x) => x.id === a11);
    ok("Attempt report row: 1 correct, 2 wrong, 1 unanswered, 25 %, counted", d.attemptsList.length === 6 && row?.correct === 1 && row.wrong === 2 && row.unanswered === 1 && num(row.percent) === 25 && row.counted === true, JSON.stringify(row));
    ok("Security: the BLUR event is reported with its learner", d.security.byKind.find((k) => k.kind === "BLUR")?.events === 1 && d.security.events[0]?.email === users.l3.email, JSON.stringify(d.security.byKind));
    const [mi] = await tx.$queryRawUnsafe(`select count(*)::int n, count(distinct "memberId")::int l from public."MistakeItem" where "programId"=$1`, COURSE);
    ok("Mistakes summary matches the mistakes table", mi.n > 0 && d.mistakes.total === mi.n && d.mistakes.learners === mi.l && d.mistakes.mastered === 0, JSON.stringify({ db: mi, report: d.mistakes }));
    ok("Filter options list the used exams and the learners who attempted", d.options.exams.length === 3 && d.options.learners.length === 3, JSON.stringify([d.options.exams.length, d.options.learners.length]));

    // ── filters and scopes ──
    d = await must("exam_analytics_course", COURSE, { scope: "first" });
    ok("Scope first attempts: 25, 50, 0 → average 25", d.summary.counted === 3 && num(d.summary.avgPercent) === 25, JSON.stringify(d.summary));
    d = await must("exam_analytics_course", COURSE, { scope: "last" });
    ok("Scope last attempts: 100, 50, 0 → average 50", d.summary.counted === 3 && num(d.summary.avgPercent) === 50, JSON.stringify(d.summary));
    d = await must("exam_analytics_course", COURSE, { scope: "best" });
    ok("Scope best attempts: 100, 50, 0 → average 50; improvement still computed", d.summary.counted === 3 && num(d.summary.maxPercent) === 100 && d.improvement.pairs === 1, JSON.stringify(d.summary));
    d = await must("exam_analytics_course", COURSE, { examId: E1 });
    ok("Filter by exam: 4 attempts, average 58.3, only E1 questions", d.summary.attempts === 4 && num(d.summary.avgPercent) === 58.3 && d.questions.length === 4, JSON.stringify(d.summary));
    const [m1] = await tx.$queryRawUnsafe(`select "id" from public."ExamMember" where "email"=$1`, users.l1.email);
    d = await must("exam_analytics_course", COURSE, { memberId: m1.id });
    ok("Filter by learner: 3 attempts, one learner", d.summary.attempts === 3 && d.summary.learners === 1 && d.learners.length === 1, JSON.stringify(d.summary));
    d = await must("exam_analytics_course", COURSE, { from: "2999-01-01" });
    ok("Date filter in the future: empty", d.summary.attempts === 0 && d.attemptsList.length === 0, JSON.stringify(d.summary));
    d = await must("exam_analytics_course", COURSE, { to: "2999-01-01", from: "2000-01-01" });
    ok("Date range including today keeps everything", d.summary.attempts === 6, JSON.stringify(d.summary));
    r = await j("exam_analytics_course", COURSE, { scope: "random" });
    ok("Unknown scope refused", /invalid: scope/.test(r.error ?? ""), r.error);
    r = await j("exam_analytics_course", COURSE, { from: "not-a-date" });
    ok("Malformed date refused (no partial report)", !!r.error, r.error);

    // ── one question ──
    r = await j("exam_analytics_question", COURSE, qMCQ, { examId: E1 });
    const opt = (id) => r.value?.options?.find((x) => x.id === id);
    ok("Choice distribution: o1 = 1, o2 = 2 (correct), o3 = 0 (the open attempt is not counted)", r.value?.asked === 3 && opt("o1")?.count === 1 && opt("o2")?.count === 2 && opt("o2").correct === true && opt("o3").count === 0 && opt("o1").correct === false, r.error ?? JSON.stringify(r.value?.options));
    r = await j("exam_analytics_question", COURSE, qTF, {});
    ok("True/false distribution: true 2 (correct), false 2", r.value?.options?.find((x) => x.id === "true")?.count === 2 && r.value.options.find((x) => x.id === "false").count === 2 && r.value.options.find((x) => x.id === "true").correct === true, r.error ?? JSON.stringify(r.value?.options));
    r = await j("exam_analytics_question", COURSE, qSH, {});
    ok("Typed answers listed with their frequency and correctness", r.value?.answers?.length === 2 && r.value.answers.find((a) => a.text === "خطر")?.correct === true && r.value.answers.find((a) => a.text === "فرصة")?.correct === false && r.value.results.unanswered === 1, r.error ?? JSON.stringify(r.value));
    r = await j("exam_analytics_question", COURSE, qA, {});
    ok("A question nobody has answered yet → not_found", /not_found/.test(r.error ?? ""), r.error ?? "");

    // ── learner report ──
    await as(users.l1);
    r = await j("exam_analytics_me", COURSE);
    let me = r.value;
    ok("Learner: 3 attempts, 2 released, 1 waiting (manual results)", me?.summary.attempts === 3 && me.summary.released === 2 && me.summary.waiting === 1, r.error ?? JSON.stringify(me?.summary));
    ok("…average 62.5 and best 100 from released attempts only", num(me.summary.avgPercent) === 62.5 && num(me.summary.bestPercent) === 100 && me.summary.examsPassed === 1, JSON.stringify(me.summary));
    ok("…the hidden exam does not appear anywhere", !JSON.stringify(me).includes(EH) && !JSON.stringify(me).includes(a1h), "");
    ok("…progress per exam: 25 → 100 (+75)", me.exams.length === 1 && num(me.exams[0].change) === 75 && me.exams[0].attempts.length === 2, JSON.stringify(me.exams));
    ok("…domain 2 counts only released answers (2 asked, 2 correct)", me.domains.find((x) => x.key === D2)?.asked === 2 && me.domains.find((x) => x.key === D2).correct === 2, JSON.stringify(me.domains));
    ok("…contains no other learner and no question text or answer", !JSON.stringify(me).includes(users.l2.email) && !JSON.stringify(me).includes(a2) && !JSON.stringify(me).includes("اختر الصحيح") && !JSON.stringify(me).includes('"o2"'), "");
    await as(users.inst);
    await must("exam_exam_release_results", EH);
    await as(users.l1);
    me = await must("exam_analytics_me", null);
    ok("After release the third attempt joins (all courses): average 41.7", me.summary.released === 3 && me.summary.waiting === 0 && num(me.summary.avgPercent) === 41.7, JSON.stringify(me.summary));
    await as(users.l2);
    me = await must("exam_analytics_me", COURSE);
    ok("An essay awaiting grading is 'waiting', not a zero", me.summary.attempts === 2 && me.summary.released === 1 && num(me.summary.avgPercent) === 50, JSON.stringify(me.summary));
    await as(users.l4);
    me = await must("exam_analytics_me", null);
    ok("A learner with no attempts gets an empty report", me.summary.attempts === 0 && me.summary.avgPercent === null && me.exams.length === 0 && me.domains.length === 0, JSON.stringify(me.summary));

    // grading the essay moves it into the counted attempts
    await as(users.inst);
    await must("exam_attempt_grade", await aq(a2e, qES), 3, "جيد");
    d = await must("exam_analytics_course", COURSE, { examId: EE });
    ok("After grading, the essay attempt is counted (3 of 4 = 75 %)", d.summary.counted === 1 && d.summary.pendingGrading === 0 && num(d.summary.avgPercent) === 75 && d.questions[0].correct === 0 && num(d.questions[0].facility) === 75, JSON.stringify([d.summary, d.questions]));

    // an overdue attempt is closed by the report itself
    await tx.$executeRawUnsafe(`update public."ExamAttempt" set "deadlineAt" = now() - interval '1 hour', "startedAt" = now() - interval '2 hours' where "id" = $1`, a3);
    await as(users.inst);
    d = await must("exam_analytics_course", COURSE, { examId: E1 });
    ok("An overdue open attempt is closed as TIMED_OUT and counted", d.summary.inProgress === 0 && d.summary.counted === 4 && d.exams[0].timedOut === 1, JSON.stringify(d.summary));
    await as(users.admin);
    await must("exam_attempt_cancel", a3, "اختبار");
    await as(users.inst);
    d = await must("exam_analytics_course", COURSE, { examId: E1 });
    ok("A cancelled attempt leaves every statistic", d.summary.attempts === 3 && d.summary.cancelled === 1 && d.summary.counted === 3 && d.summary.learners === 2, JSON.stringify(d.summary));

    // discrimination: 10 learners; whoever gets A right also gets B right (correlation +1)
    for (const [i, c] of crowd.entries()) await take(c, ED, { [qA]: { value: i < 6 }, [qB]: { value: i < 6 } });
    await tx.$executeRawUnsafe(`delete from public."ExamRateLimit" where "key" like 'analytics:%'`);
    await as(users.inst);
    d = await must("exam_analytics_course", COURSE, { examId: ED });
    ok("With 10 sheets discrimination is reported: perfectly consistent items = 1.00", d.questions.length === 2 && d.questions.every((q) => num(q.discrimination) === 1 && num(q.facility) === 60), JSON.stringify(d.questions.map((q) => [q.facility, q.discrimination])));
    ok("…distribution 4 × 0 % and 6 × 100 %", d.distribution[0].count === 4 && d.distribution[9].count === 6 && num(d.summary.passRate) === 60, JSON.stringify(d.distribution.map((b) => b.count)));

    // ── permissions ──
    for (const [who, label] of [[users.l1, "A learner"], [users.noResults, "An instructor without canViewResults"], [users.other, "An instructor of another course"]]) {
      await as(who);
      const c = await j("exam_analytics_course", COURSE, {});
      const q = await j("exam_analytics_question", COURSE, qMCQ, {});
      ok(`${label} cannot open the course report or a question analysis`, /forbidden/.test(c.error ?? "") && /forbidden/.test(q.error ?? ""), `${c.error} | ${q.error}`);
    }
    await as(null);
    r = await j("exam_analytics_me", null);
    ok("Without a signed-in member the personal report is refused", /not_authenticated/.test(r.error ?? ""), r.error ?? "");
    r = await j("exam_analytics_course", COURSE, {});
    ok("Without a signed-in member the course report is refused", /forbidden/.test(r.error ?? ""), r.error ?? "");
    await as(users.admin);
    r = await j("exam_analytics_course", COURSE, {});
    ok("The admin can open any course report", r.value?.summary?.attempts > 0, r.error ?? "");

    // export is recorded
    const logs = async () => (await tx.$queryRawUnsafe(`select count(*)::int n from public."ExamAuditLog" where "action"='analytics.export' and "programId"=$1`, COURSE))[0].n;
    const before = await logs();
    await must("exam_analytics_course", COURSE, { export: true });
    ok("Exporting writes an audit entry; normal viewing does not", before === 0 && (await logs()) === 1, `${before} → ${await logs()}`);

    // access rights of the functions themselves
    const [p] = await tx.$queryRawUnsafe(`select
      has_function_privilege('anon','public.exam_analytics_course(text,jsonb)','execute') a1,
      has_function_privilege('anon','public.exam_analytics_me(text)','execute') a2,
      has_function_privilege('authenticated','public.exam_analytics_ids(text,jsonb)','execute') h1,
      has_function_privilege('authenticated','public.exam_analytics_counted(text[],text)','execute') h2,
      has_function_privilege('authenticated','public.exam_analytics_breakdown(text[],text)','execute') h3,
      has_function_privilege('authenticated','public.exam_analytics_course(text,jsonb)','execute') u1`);
    ok("anon cannot execute the reports; helpers are not callable by browsers", !p.a1 && !p.a2 && !p.h1 && !p.h2 && !p.h3 && p.u1, JSON.stringify(p));
    ok("Scores of the attempts themselves are untouched by reporting", num((await call(`select "percent" from public."ExamAttempt" where "id"=$1`, a12)).value) === 100 && !!a2, "");

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
