// Phase 9 (Mistakes Quiz, mastery policy, staff report) tests
// run: node --env-file=.env scripts/test-exams-mistakes.mjs — one transaction, rolled back at the end.
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";

const db = new PrismaClient();
const PMP = "cmwx44kbb0001gvkwzr4kyo1l";
const CAPM = "cmwx44lbw0004gvkw5oretlpz";
const SECRET_FB = "FEEDBACK-SECRET-9";
const results = [];
const ok = (name, pass, info = "") => results.push({ name, pass, info });
const ROLLBACK = new Error("rollback");
const u = (n) => ({ sub: randomUUID(), email: `t-${n}@phase9.test` });
const users = { admin: u("admin"), inst: u("inst"), noResults: u("noresults"), capm: u("capm"), l1: u("l1"), l2: u("l2") };

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
    const cast = (v) => (typeof v === "object" && v !== null ? "::jsonb" : typeof v === "boolean" ? "::boolean" : typeof v === "number" ? (Number.isInteger(v) ? "::int" : "::numeric") : "");
    const j = (fn, ...a) => call(`select public.${fn}(${a.map((v, i) => `$${i + 1}${cast(v)}`).join(",")})`, ...a.map((x) => (typeof x === "object" && x !== null ? JSON.stringify(x) : x)));
    const aq = async (attempt, question) => (await call(`select "id" from public."AttemptQuestion" where "attemptId"=$1 and "questionId"=$2`, attempt, question)).value;
    const overview = async (filter = {}) => (await j("exam_mistakes_overview", PMP, filter)).value;
    const item = async (questionId) => (await overview()).items.find((x) => x.questionId === questionId);
    // answer one session question by its source question
    const sessAnswer = async (sid, questionId, response) => {
      const st = (await j("exam_mistakes_state", sid)).value;
      const mid = (await item(questionId))?.id;
      const sq = (await call(`select "id" from public."MistakeSessionQuestion" where "sessionId"=$1 and "mistakeId"=$2`, sid, mid)).value;
      return { st, r: await j("exam_mistakes_answer", sid, sq, response) };
    };

    for (const x of Object.values(users)) { await as(x); await call("select public.exam_me()"); }
    await tx.$executeRawUnsafe(`update public."ExamMember" set "role"='LEARNER' where "role"='ADMIN'`);
    await tx.$executeRawUnsafe(`update public."ExamMember" set "role"='ADMIN' where "email"=$1`, users.admin.email);
    await tx.$executeRawUnsafe(`delete from public."Setting" where "key"='examMasteryStreak'`);
    await as(users.admin);
    await j("exam_admin_assign_instructor", PMP, users.inst.email, { canReopenAttempts: true, canPublishExams: true, canReviewEssays: true });
    await j("exam_admin_assign_instructor", PMP, users.noResults.email, { canViewResults: false });
    await j("exam_admin_assign_instructor", CAPM, users.capm.email, {});
    await j("exam_admin_enroll", PMP, users.l1.email);
    await j("exam_admin_enroll", PMP, users.l2.email);

    await as(users.inst);
    const o = (...t) => t.map((x, i) => ({ id: `o${i + 1}`, textAr: x }));
    const common = { status: "ACTIVE", points: 1, feedbackAr: SECRET_FB, explanationAr: "شرح" };
    const save = async (d) => (await j("exam_bank_question_save", PMP, { ...common, ...d })).value.id;
    const qTF = await save({ type: "TRUE_FALSE", stemAr: "صح أم خطأ", difficulty: "EASY", answer: { value: true } });
    const qMCQ = await save({ type: "MCQ", stemAr: "اختر", content: { options: o("أ", "ب", "ج") }, answer: { correct: ["o2"] } });
    const qNUM = await save({ type: "NUMERIC", stemAr: "عدد", answer: { value: 10, tolerance: 0 } });
    const qESS = await save({ type: "ESSAY", stemAr: "مقال", points: 4, content: { maxWords: 100 }, answer: { rubricAr: "دليل" } });
    const qHID = await save({ type: "TRUE_FALSE", stemAr: "نتيجة مؤجلة", answer: { value: true } });
    const qNEV = await save({ type: "MCQ", stemAr: "بلا مراجعة", content: { options: o("أ", "ب") }, answer: { correct: ["o1"] } });
    const DOM = (await j("exam_course_folders", PMP)).value.find((f) => f.kind === "DOMAIN_TESTS").id;
    const mk = async (title, items, extra = {}) => {
      const r = await j("exam_exam_save", { folderId: DOM, titleAr: title, durationMinutes: 30, maxAttempts: 5, items: items.map((questionId) => ({ questionId })), ...extra });
      return (await j("exam_exam_publish", r.value.id)).value.id;
    };
    const EA = await mk("اختبار المجال", [qTF, qMCQ, qNUM, qESS]);
    const EH = await mk("نتيجة يدوية", [qHID], { resultsPolicy: "MANUAL" });
    const EN = await mk("بلا مراجعة", [qNEV], { reviewPolicy: "NEVER" });

    // ── collection ──
    await as(users.l1);
    let r = await j("exam_mistakes_overview", PMP, {});
    ok("Learner with no mistakes: empty list, mastery policy default 2", r.value?.counts?.total === 0 && r.value.masteryStreak === 2, r.error ?? JSON.stringify(r.value?.counts));
    const A1 = (await j("exam_attempt_start", EA)).value.attemptId;
    await j("exam_attempt_save", A1, await aq(A1, qTF), { value: false }, false);
    await j("exam_attempt_save", A1, await aq(A1, qMCQ), { choice: "o2" }, false);
    await j("exam_attempt_save", A1, await aq(A1, qESS), { text: "إجابة قصيرة" }, false);
    r = await j("exam_attempt_save", A1, await aq(A1, qNUM), { text: "x" }, false);
    ok("Official exam: a malformed answer is refused (not stored)", /invalid_response/.test(r.error), r.error ?? JSON.stringify(r.value));
    await j("exam_attempt_submit", A1);
    let ov = await overview();
    ok("Wrong answer collected; correct and unanswered questions are not", ov.counts.total === 1 && ov.items[0].questionId === qTF && ov.counts.notReviewed === 1, JSON.stringify(ov.items.map((x) => x.stemAr)));
    ok("The list carries no answer, feedback or explanation", !JSON.stringify(ov.items).includes(SECRET_FB) && !("answer" in ov.items[0]), "");
    r = await call(`select public.exam_collect_mistakes($1)`, A1);
    ov = await overview();
    ok("Collecting the same attempt twice adds nothing (idempotent)", r.value === 0 && ov.items[0].wrongCount === 1, JSON.stringify({ n: r.value, w: ov.items[0].wrongCount }));

    await as(users.inst);
    r = await j("exam_attempt_grade", await aq(A1, qESS), 2, "ناقص");
    await as(users.l1);
    ov = await overview();
    ok("An essay graded below full marks joins the mistakes list", r.value && ov.counts.total === 2 && ov.items.some((x) => x.questionId === qESS), r.error ?? String(ov.counts.total));

    const [scoreBefore] = await tx.$queryRawUnsafe(`select "score"::text s, "status" from public."ExamAttempt" where "id"=$1`, A1);
    // ── detail / privacy ──
    const mTF = (await item(qTF)).id;
    await as(users.l2);
    r = await j("exam_mistake_detail", mTF);
    ok("Another learner cannot open someone else's mistake", /not_found/.test(r.error), r.error);
    await as(users.l1);
    r = await j("exam_mistake_detail", mTF);
    ok("Opening a mistake marks it REVIEWED and shows my wrong answer", r.value?.status === "REVIEWED" && r.value.lastResponse?.value === false, JSON.stringify({ s: r.value?.status, lr: r.value?.lastResponse }));
    ok("…and reveals answer + feedback because the source exam allows review", r.value?.reveal?.answer?.value === true && r.value.reveal.feedbackAr === SECRET_FB, JSON.stringify(r.value?.reveal));
    ok("…the question itself is sent without the answer", !("answer" in (r.value?.data ?? {})) && r.value?.data?.stemAr === "صح أم خطأ", JSON.stringify(r.value?.data));

    // results not released → hidden; released → shown
    const AH = (await j("exam_attempt_start", EH)).value.attemptId;
    await j("exam_attempt_save", AH, await aq(AH, qHID), { value: false }, false);
    await j("exam_attempt_submit", AH);
    ov = await overview();
    ok("A mistake from an exam whose results are not released stays hidden", ov.counts.total === 2 && !ov.items.some((x) => x.questionId === qHID), String(ov.counts.total));
    await as(users.inst);
    await j("exam_exam_release_results", EH);
    await as(users.l1);
    ov = await overview();
    ok("…and appears once the results are released", ov.counts.total === 3 && ov.items.some((x) => x.questionId === qHID), String(ov.counts.total));

    // review NEVER → no answer revealed
    const AN = (await j("exam_attempt_start", EN)).value.attemptId;
    await j("exam_attempt_save", AN, await aq(AN, qNEV), { choice: "o2" }, false);
    await j("exam_attempt_submit", AN);
    const mNEV = (await item(qNEV))?.id;
    r = await j("exam_mistake_detail", mNEV);
    ok("Exam with review NEVER: the mistake is listed but the answer is not revealed", r.value && Object.keys(r.value.reveal ?? {}).length === 0, JSON.stringify(r.value?.reveal ?? r.error));
    await as(users.inst);
    await j("exam_attempt_cancel", AN, "إلغاء للاختبار");
    await as(users.l1);
    ov = await overview();
    ok("A mistake whose only source attempt was cancelled disappears from the list", !ov.items.some((x) => x.questionId === qNEV), String(ov.counts.total));

    // filters
    ov = await overview({ difficulty: "EASY" });
    ok("Filter by difficulty", ov.items.length === 1 && ov.items[0].questionId === qTF, JSON.stringify(ov.items.map((x) => x.difficulty)));
    ov = await overview({ type: "ESSAY" });
    ok("Filter by question type", ov.items.length === 1 && ov.items[0].questionId === qESS, String(ov.items.length));

    // ── review session ──
    r = await j("exam_mistakes_start", PMP, { count: 10, minutes: 0 });
    ok("Invalid timer → rejected", /invalid_mistakes: minutes/.test(r.error), r.error);
    r = await j("exam_mistakes_start", PMP, { count: 10 });
    const S1 = r.value?.sessionId;
    ok("Review session starts from my open mistakes", S1 && r.value.resumed === false, r.error ?? "");
    r = await j("exam_mistakes_start", PMP, { count: 10 });
    ok("Starting again resumes the open session", r.value?.sessionId === S1 && r.value.resumed === true, JSON.stringify(r.value));
    let st = (await j("exam_mistakes_state", S1)).value;
    ok("Session has the 3 visible mistakes; question data has no answer", st.questionCount === 3 && st.questions.every((q) => !("answer" in q.data)) && !JSON.stringify(st).includes(SECRET_FB), String(st.questionCount));
    await as(users.l2);
    r = await j("exam_mistakes_state", S1);
    ok("Another learner cannot open my session", /not_found/.test(r.error), r.error);
    await as(users.l1);
    let a = await sessAnswer(S1, qTF, { choice: "x" });
    ok("Malformed answer → rejected", /invalid_response/.test(a.r.error), a.r.error);
    a = await sessAnswer(S1, qTF, { value: true });
    ok("Correct answer graded on the server; feedback shown at once (AFTER_ANSWER)", a.r.value?.isCorrect === true && a.r.value.reveal?.answer?.value === true, JSON.stringify(a.r.value));
    a = await sessAnswer(S1, qTF, { value: false });
    ok("A question cannot be answered twice", /already_answered/.test(a.r.error), a.r.error);
    a = await sessAnswer(S1, qHID, { value: false });
    ok("Wrong answer in review", a.r.value?.isCorrect === false, JSON.stringify(a.r.value));
    a = await sessAnswer(S1, qESS, { text: "محاولة" });
    ok("Essay in review: not auto-graded, the guide is shown for self-check", a.r.value?.isCorrect === null && a.r.value.reveal?.answer?.rubricAr === "دليل", JSON.stringify(a.r.value));
    r = await j("exam_mistakes_submit", S1);
    ok("Session submitted: own score 1/3", r.value?.status === "COMPLETED" && r.value.correctCount === 1 && Number(r.value.maxScore) === 3, JSON.stringify({ s: r.value?.status, c: r.value?.correctCount }));
    ov = await overview();
    let iTF = ov.items.find((x) => x.questionId === qTF), iHID = ov.items.find((x) => x.questionId === qHID);
    ok("Correct in review → CORRECT_IN_REVIEW, streak 1 (policy needs 2)", iTF.status === "CORRECT_IN_REVIEW" && iTF.correctStreak === 1 && iTF.reviewCorrect === 1, JSON.stringify(iTF));
    ok("Wrong in review → WRONG_AGAIN", iHID.status === "WRONG_AGAIN" && iHID.reviewWrong === 1, iHID.status);
    const [scoreAfter] = await tx.$queryRawUnsafe(`select "score"::text s, "status" from public."ExamAttempt" where "id"=$1`, A1);
    ok("The official attempt's grade is untouched by review sessions", scoreAfter.s === scoreBefore.s && scoreAfter.status === scoreBefore.status, JSON.stringify([scoreBefore, scoreAfter]));
    r = await j("exam_mistakes_answer", S1, (await call(`select "id" from public."MistakeSessionQuestion" where "sessionId"=$1 limit 1`, S1)).value, { value: true });
    ok("Closed session refuses answers", /session_closed/.test(r.error), r.error);

    // second correct session → mastered
    const S2 = (await j("exam_mistakes_start", PMP, { ids: [iTF.id] })).value.sessionId;
    await sessAnswer(S2, qTF, { value: true });
    await j("exam_mistakes_submit", S2);
    iTF = await item(qTF);
    r = await j("exam_mistake_detail", iTF.id);
    ok("Two consecutive correct sessions → MASTERED (history kept)", iTF.status === "MASTERED" && iTF.masteredAt && r.value.history.some((h) => h.kind === "MASTERED"), JSON.stringify({ s: iTF.status, h: r.value?.history?.map((h) => h.kind) }));
    st = await overview();
    ok("Default session excludes mastered questions", (await (async () => { const s = (await j("exam_mistakes_start", PMP, {})).value.sessionId; const x = (await j("exam_mistakes_state", s)).value; await j("exam_mistakes_submit", s); return x.questions.length === 2; })()), "");

    // wrong again in an exam → back from mastered
    const A2 = (await j("exam_attempt_start", EA)).value.attemptId;
    await j("exam_attempt_save", A2, await aq(A2, qTF), { value: false }, false);
    await j("exam_attempt_submit", A2);
    iTF = await item(qTF);
    r = await j("exam_mistake_detail", iTF.id);
    ok("A mastered question answered wrongly in a new exam → WRONG_AGAIN, wrongCount 2, REOPENED logged", iTF.status === "WRONG_AGAIN" && iTF.wrongCount === 2 && iTF.correctStreak === 0 && r.value.history.some((h) => h.kind === "REOPENED"), JSON.stringify(iTF));

    // AFTER_SESSION feedback + timer
    const S3 = (await j("exam_mistakes_start", PMP, { ids: [iTF.id], feedbackMode: "AFTER_SESSION", minutes: 5 })).value.sessionId;
    a = await sessAnswer(S3, qTF, { value: true });
    ok("AFTER_SESSION mode: no feedback while the session runs", a.r.value?.isCorrect === true && a.r.value.reveal === null && a.st.questions[0].reveal === null, JSON.stringify(a.r.value));
    await tx.$executeRawUnsafe(`update public."MistakeSession" set "deadlineAt" = now() - interval '1 second' where "id"=$1`, S3);
    st = (await j("exam_mistakes_state", S3)).value;
    ok("Timer over → the server closes the session with what was answered, feedback now shown", st.status === "COMPLETED" && st.correctCount === 1 && st.questions[0].reveal?.answer?.value === true, JSON.stringify({ s: st.status, c: st.correctCount }));

    // ── mastery policy ──
    r = await j("exam_admin_set_mastery", 1);
    ok("Learner cannot change the mastery policy", /forbidden|not_admin/.test(r.error), r.error);
    await as(users.admin);
    r = await j("exam_admin_set_mastery", 9);
    ok("Mastery policy outside 1–5 → rejected", /invalid_mistakes: streak/.test(r.error), r.error);
    r = await j("exam_admin_set_mastery", 1);
    ok("Admin sets mastery to 1 correct session", r.value?.masteryStreak === 1, r.error ?? "");
    await as(users.l1);
    iHID = await item(qHID);
    const S4 = (await j("exam_mistakes_start", PMP, { ids: [iHID.id] })).value.sessionId;
    await sessAnswer(S4, qHID, { value: true });
    await j("exam_mistakes_submit", S4);
    iHID = await item(qHID);
    ok("With policy 1, one correct session masters the question", iHID.status === "MASTERED", iHID.status);

    // ── access ──
    r = await j("exam_mistakes_start", CAPM, {});
    ok("Learner cannot start a review in a course they are not enrolled in", /forbidden/.test(r.error), r.error);
    await as(users.l2);
    r = await j("exam_mistakes_start", PMP, {});
    ok("No mistakes → nothing to review", /no_mistakes/.test(r.error), r.error);
    await as(null);
    r = await j("exam_mistakes_overview", PMP, {});
    ok("Not signed in → refused", /not_authenticated/.test(r.error), r.error);

    // ── staff report ──
    await as(users.inst);
    r = await j("exam_mistakes_report", PMP);
    const me1 = r.value?.learners?.find((x) => x.email === users.l1.email);
    ok("Instructor report: per learner totals and mastered", me1 && me1.total >= 3 && me1.mastered === 1, JSON.stringify(me1 ?? r.error));
    ok("…most-missed questions (qTF wrong twice is first)", r.value?.questions?.[0]?.questionId === qTF && r.value.questions[0].wrongs === 2, JSON.stringify(r.value?.questions?.[0]));
    await as(users.noResults);
    r = await j("exam_mistakes_report", PMP);
    ok("Instructor without results permission cannot read the report", /forbidden/.test(r.error), r.error);
    await as(users.capm);
    r = await j("exam_mistakes_report", PMP);
    ok("Instructor of another course cannot read it", /forbidden/.test(r.error), r.error);
    await as(users.l1);
    r = await j("exam_mistakes_report", PMP);
    ok("Learner cannot read the staff report", /forbidden/.test(r.error), r.error);

    // ── direct table access is closed for browser roles ──
    const [g] = await tx.$queryRawUnsafe(`select has_table_privilege('authenticated','public."MistakeItem"','select') a, has_table_privilege('anon','public."MistakeSession"','select') b, has_function_privilege('authenticated','public.exam_collect_mistakes(text)','execute') c`);
    ok("Browser roles have no table access and cannot call the collector", !g.a && !g.b && !g.c, JSON.stringify(g));

    throw ROLLBACK;
  }, { timeout: 300000 });
} catch (e) {
  if (e !== ROLLBACK) { console.error("✗ test run failed:", e.message); process.exitCode = 1; }
}

const [left] = await db.$queryRawUnsafe(`select (select count(*)::int from public."ExamMember" where "email" like '%@phase9.test') m, (select count(*)::int from public."MistakeItem") i, (select count(*)::int from public."MistakeSession") s, (select role from public."ExamMember" where "email"='training@aldaleel.ly') admin`);
ok("Rollback: no test data left; the real admin keeps the ADMIN role", left.m === 0 && left.i === 0 && left.s === 0 && left.admin === "ADMIN", JSON.stringify(left));
await db.$disconnect();

for (const t of results) console.log(`${t.pass ? "✔" : "✗"} ${t.name}${t.pass ? "" : `  ← ${t.info}`}`);
const failed = results.filter((t) => !t.pass).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
if (failed) process.exitCode = 1;
