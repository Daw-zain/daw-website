// Phase 6 (attempts, timer, grading, review) tests — run: node --env-file=.env scripts/test-exams-attempts.mjs
// One transaction, rolled back at the end. Expiry is simulated by moving deadlineAt / lastSeenAt into the past.
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";

const db = new PrismaClient();
// two courses without questions of their own, so real data never changes the expected numbers
const [PMP, CAPM] = (await db.$queryRawUnsafe(`select "id" from public."Program" p where not exists (select 1 from public."Question" q where q."programId"=p."id") order by p."order" limit 2`)).map((r) => r.id);
const results = [];
const ok = (name, pass, info = "") => results.push({ name, pass, info });
const ROLLBACK = new Error("rollback");
const u = (n) => ({ sub: randomUUID(), email: `t-${n}@phase6.test` });
const users = { admin: u("admin"), inst: u("inst"), noResults: u("noresults"), capm: u("capm"), l1: u("l1"), l2: u("l2"), outsider: u("outsider") };
const SECRET_EXPL = "شرح سري لا يظهر أثناء الاختبار";
const SECRET_FB = "تغذية سرية";

// what the same query finds before the test starts
const [before] = await db.$queryRawUnsafe(`select (select count(*)::int from public."ExamMember" where "email" like '%@phase6.test') m, (select count(*)::int from public."ExamAttempt") a, (select count(*)::int from public."Exam") e, (select count(*)::int from public."Question") q`);

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
    const sql = (q, ...a) => tx.$executeRawUnsafe(q, ...a);

    for (const x of Object.values(users)) { await as(x); await call("select public.exam_me()"); }
    await sql(`update public."ExamMember" set "role"='ADMIN' where "email"=$1`, users.admin.email);
    await as(users.admin);
    await j("exam_admin_assign_instructor", PMP, users.inst.email, { canReopenAttempts: true, canPublishExams: true });
    await j("exam_admin_assign_instructor", PMP, users.noResults.email, { canViewResults: false });
    await j("exam_admin_assign_instructor", CAPM, users.capm.email, {});
    await j("exam_admin_enroll", PMP, users.l1.email);
    await j("exam_admin_enroll", PMP, users.l2.email);
    const L1 = (await call(`select "id" from public."ExamMember" where "email"=$1`, users.l1.email)).value;

    // ── bank: one question of every type with known answers ──
    await as(users.inst);
    const o = (...t) => t.map((x, i) => ({ id: `o${i + 1}`, textAr: x }));
    const common = { status: "ACTIVE", points: 1, feedbackAr: SECRET_FB, explanationAr: SECRET_EXPL };
    const defs = {
      MCQ: { type: "MCQ", stemAr: "س1", content: { options: o("أ", "ب", "ج") }, answer: { correct: ["o2"] } },
      MULTI: { type: "MULTI", stemAr: "س2", points: 2, content: { options: o("أ", "ب", "ج", "د") }, answer: { correct: ["o1", "o3"] }, scoring: { mode: "PARTIAL" } },
      TRUE_FALSE: { type: "TRUE_FALSE", stemAr: "س3", answer: { value: false } },
      NUMERIC: { type: "NUMERIC", stemAr: "س4", answer: { value: 10, tolerance: 0.5 } },
      SHORT: { type: "SHORT", stemAr: "س5", answer: { accepted: ["Work Breakdown Structure"] } },
      ESSAY: { type: "ESSAY", stemAr: "س6", points: 4, content: { maxWords: 100 }, answer: { rubricAr: "دليل" } },
      ORDERING: { type: "ORDERING", stemAr: "س7", content: { items: o("1", "2", "3", "4") }, answer: { order: ["o1", "o2", "o3", "o4"] } },
      MATCHING: { type: "MATCHING", stemAr: "س8", content: { left: o("L1", "L2"), right: o("R1", "R2", "R3") }, answer: { pairs: { o1: "o2", o2: "o1" } } },
    };
    const qid = {};
    for (const [k, d] of Object.entries(defs)) qid[k] = (await j("exam_bank_question_save", PMP, { ...common, ...d })).value?.id;
    const S = (await j("exam_bank_scenario_save", PMP, { titleAr: "حالة", bodyAr: "نص الحالة", status: "ACTIVE" })).value.id;
    const sq = [];
    for (let i = 1; i <= 2; i++) sq.push((await j("exam_bank_question_save", PMP, { ...common, type: "TRUE_FALSE", stemAr: `حالة س${i}`, scenarioId: S, answer: { value: true } })).value.id);
    const imgPath = `${PMP}/${qid.MCQ}/${randomUUID()}.png`;
    await call("select public.exam_asset_register('QUESTION',$1,$2,'image/png',100::int,'a.png','','')", qid.MCQ, imgPath);

    const folders = (await j("exam_course_folders", PMP)).value;
    const DOM = folders.find((f) => f.kind === "DOMAIN_TESTS").id;
    const mk = async (extra) => {
      const r = await j("exam_exam_save", { folderId: DOM, titleAr: "اختبار", durationMinutes: 30, maxAttempts: 2, passPercent: 60, items: Object.values(qid).map((id) => ({ questionId: id })), rules: [{ count: 1, scenarios: true }], ...extra });
      const p = await j("exam_exam_publish", r.value?.id);
      return p.value?.id ?? r.error ?? p.error;
    };
    const EA = await mk({});
    ok("Exam published (8 picked + 1 scenario of 2)", typeof EA === "string" && EA.length > 20, EA);

    // ── who may start ──
    await as(users.outsider);
    let r = await j("exam_take_info", EA);
    ok("Not enrolled → exam info refused", /forbidden/.test(r.error), r.error);
    r = await j("exam_attempt_start", EA);
    ok("Not enrolled → start refused", /forbidden/.test(r.error), r.error);
    await as(users.l1);
    r = await j("exam_take_info", EA);
    ok("Enrolled learner: can start, 0 of 2 attempts used, 10 questions", r.value?.canStart === true && r.value.attemptsUsed === 0 && r.value.attemptsAllowed === 2 && r.value.questionCount === 10, JSON.stringify({ c: r.value?.canStart, u: r.value?.attemptsUsed, q: r.value?.questionCount }));

    // ── start + what the browser receives ──
    r = await j("exam_attempt_start", EA);
    const A1 = r.value?.attemptId;
    ok("Start an attempt", !!A1 && r.value.resumed === false, r.error ?? "");
    r = await j("exam_attempt_state", A1);
    const st = r.value;
    const blob = JSON.stringify(st ?? {});
    ok("State: 10 questions, in progress, server deadline ≈ 30 min", st?.questions?.length === 10 && st.status === "IN_PROGRESS" && Math.abs(new Date(st.deadlineAt + "Z") - new Date(st.serverNow) - 30 * 60000) < 5000, JSON.stringify({ n: st?.questions?.length, s: st?.status, d: st?.deadlineAt, now: st?.serverNow }));
    ok("NOTHING revealing is sent: no answer / feedback / explanation / rationale / accepted / pairs / snapshot", !/"answer"|"correct"|feedback|explanation|[Rr]ationale|accepted|"pairs"|snapshot|rubric/.test(blob) && !blob.includes(SECRET_EXPL) && !blob.includes(SECRET_FB) && !blob.includes("Work Breakdown"), blob.slice(0, 200));
    const byStem = (s) => st.questions.find((q) => q.data.stemAr === s);
    const ordQ = byStem("س7");
    ok("Ordering items are never handed out in the correct order", ordQ.data.items.map((i) => i.id).join() !== "o1,o2,o3,o4", ordQ.data.items.map((i) => i.id).join());
    ok("Multiple responses tells how many to choose (not which)", byStem("س2").data.selectCount === 2 && !("correct" in byStem("س2").data), "");
    const scPos = st.questions.filter((q) => q.data.scenarioId === S).map((q) => q.position);
    ok("Scenario questions are adjacent; the case is sent once", scPos.length === 2 && scPos[1] - scPos[0] === 1 && st.scenarios?.[S]?.bodyAr === "نص الحالة", JSON.stringify(scPos));
    ok("Question images travel as private paths + watermark id provided", byStem("س1").data.images?.[0]?.path === imgPath && /·/.test(st.watermark), "");

    // ── isolation ──
    await as(users.l2);
    r = await j("exam_attempt_state", A1);
    ok("Another learner cannot open this attempt", /not_found/.test(r.error), r.error);
    r = await j("exam_attempt_save", A1, st.questions[0].id, { choice: "o1" }, false);
    ok("Another learner cannot answer in this attempt", /not_found/.test(r.error), r.error);
    r = await j("exam_storage_can", imgPath, "read");
    ok("Another learner cannot read this attempt's images", r.value === false, String(r.value));
    await as(users.l1);
    r = await j("exam_storage_can", imgPath, "read");
    ok("The attempt owner can read the question image (signed URL)", r.value === true, String(r.value));
    r = await j("exam_storage_can", `${PMP}/${randomUUID()}/x.png`, "read");
    ok("…but not images of questions outside the attempt", r.value === false, String(r.value));

    // ── resume, save, validation ──
    r = await j("exam_attempt_start", EA);
    ok("Starting again while in progress resumes the same attempt", r.value?.attemptId === A1 && r.value.resumed === true, "");
    r = await j("exam_attempt_save", A1, byStem("س1").id, { choice: "zz" }, false);
    ok("Answer with an option the learner was not shown → rejected", /invalid_response/.test(r.error), r.error);
    r = await j("exam_attempt_save", A1, byStem("س7").id, { order: ["o1", "o2"] }, false);
    ok("Incomplete ordering → rejected", /invalid_response/.test(r.error), r.error);
    const answers = [
      ["س1", { choice: "o2" }], // correct 1
      ["س2", { choices: ["o1"] }], // only 1 of the 2 right choices → 0 (full mark or zero, even if saved as partial)
      ["س3", { value: false }], // correct 1
      ["س4", { value: 10.4 }], // within tolerance 1
      ["س5", { text: "  work   breakdown structure " }], // case/space-insensitive 1
      ["س6", { text: "إجابة مقالية" }], // manual (4)
      ["س7", { order: ["o2", "o1", "o3", "o4"] }], // all-or-nothing → 0
      ["س8", { pairs: { o1: "o2", o2: "o1" } }], // correct 1
      ["حالة س1", { value: true }], // 1
      ["حالة س2", { value: false }], // 0
    ];
    let saved = 0;
    for (const [s, resp] of answers) { r = await j("exam_attempt_save", A1, byStem(s).id, resp, s === "س7"); if (r.value?.saved) saved++; }
    ok("All 10 answers saved (one flagged for review)", saved === 10, String(saved));
    r = await j("exam_take_info", EA);
    ok("Exam info shows the open attempt", r.value?.reason === "in_progress" && r.value.openAttemptId === A1, "");
    r = await j("exam_attempt_state", A1);
    ok("Reloading the page returns the saved answers and flag", r.value?.questions?.find((q) => q.data.stemAr === "س7")?.flagged === true && r.value.questions.filter((q) => q.response).length === 10, "");

    // ── submit + grading ──
    r = await j("exam_attempt_submit", A1);
    const res = r.value;
    ok("Submit: graded on the server; essay pending → SUBMITTED, pass/fail not decided yet", res?.status === "SUBMITTED" && res.needsManual === true && res.passed === null, JSON.stringify({ s: res?.status, p: res?.passed }));
    // max = 1 + 2 + 1 + 1 + 1 + 4 (essay) + 1 + 1 + 1 + 1 = 14
    ok("Score = 1+0+1+1+1+0+1+1+0 (essay pending) = 6 of 14", Number(res?.score) === 6 && Number(res?.maxScore) === 14, `${res?.score}/${res?.maxScore}`);
    ok("Review shows correct answers, feedback and explanation after submitting", res?.reviewVisible === true && res.questions.some((q) => q.explanationAr === SECRET_EXPL && q.feedbackAr === SECRET_FB && q.answer), "");
    r = await j("exam_attempt_save", A1, byStem("س1").id, { choice: "o1" }, false);
    ok("Saving after submission → refused", /attempt_closed/.test(r.error), r.error);

    // ── staff ──
    await as(users.noResults);
    r = await j("exam_exam_attempts", EA);
    ok("Instructor without results permission cannot list attempts", /forbidden/.test(r.error), r.error);
    await as(users.capm);
    r = await j("exam_attempt_detail", A1);
    ok("Instructor of another course cannot open the attempt", /forbidden/.test(r.error), r.error);
    await as(users.inst);
    r = await j("exam_exam_attempts", EA);
    ok("Instructor lists attempts with learner and score", r.value?.attempts?.length === 1 && r.value.attempts[0].email === users.l1.email, "");
    const essayId = (await j("exam_attempt_detail", A1)).value.questions.find((q) => q.type === "ESSAY").id;
    r = await j("exam_attempt_grade", essayId, 5.0, "");
    ok("Essay score above its points → refused", /invalid_grade: score/.test(r.error), r.error);
    r = await j("exam_attempt_grade", essayId, 3.0, "جيد");
    ok("Grade the essay 3/4 → completed, 9/14 = 64.29% ≥ 60% → passed", r.value?.status === "COMPLETED" && Number(r.value.score) === 9 && Number(r.value.percent) === 64.29 && r.value.passed === true, JSON.stringify({ s: r.value?.status, sc: r.value?.score, p: r.value?.percent }));

    // ── timer: the server closes the attempt ──
    await as(users.l1);
    const A2 = (await j("exam_attempt_start", EA)).value?.attemptId;
    await sql(`update public."ExamAttempt" set "deadlineAt" = now() - interval '1 minute' where "id"=$1`, A2);
    const q2 = (await call(`select "id" from public."AttemptQuestion" where "attemptId"=$1 and "type"='TRUE_FALSE' order by "position" limit 1`, A2)).value;
    r = await j("exam_attempt_save", A2, q2, null, true);
    ok("Saving after the server deadline → refused (browser clock is irrelevant)", /attempt_closed/.test(r.error), r.error);
    r = await j("exam_attempt_state", A2);
    ok("Expired attempt is finalised as TIMED_OUT and graded", r.value?.status === "TIMED_OUT" && r.value.questions.length === 0, r.value?.status);
    r = await j("exam_take_info", EA);
    ok("2 of 2 attempts used → cannot start", r.value?.canStart === false && r.value.reason === "no_attempts_left", r.value?.reason);
    r = await j("exam_attempt_start", EA);
    ok("Start beyond the limit → refused", /cannot_start: no_attempts_left/.test(r.error), r.error);

    // ── staff actions: extra attempt, reopen, cancel ──
    await as(users.inst);
    r = await j("exam_grant_attempt", EA, L1, 1);
    await as(users.l1);
    r = await j("exam_take_info", EA);
    ok("Extra attempt granted → can start again", r.value?.canStart === true && r.value.attemptsAllowed === 3, JSON.stringify({ c: r.value?.canStart, a: r.value?.attemptsAllowed }));
    await as(users.inst);
    r = await j("exam_attempt_reopen", A2, 10);
    ok("Reopen the timed-out attempt for 10 minutes", r.value?.status === "IN_PROGRESS", r.error ?? r.value?.status);
    await as(users.l1);
    r = await j("exam_attempt_save", A2, q2, { value: true }, false);
    ok("…the learner can answer again", r.value?.saved === true, r.error ?? "");
    await as(users.inst);
    r = await j("exam_attempt_cancel", A2, "إلغاء تجريبي");
    ok("Cancel an attempt", r.value?.status === "CANCELLED", r.error ?? "");
    await as(users.l1);
    r = await j("exam_take_info", EA);
    ok("A cancelled attempt does not count", r.value?.attemptsUsed === 1, String(r.value?.attemptsUsed));

    // ── grading rules in detail ──
    const g = async (snap, resp, max = 2) => (await call(`select public.exam_grade($1::jsonb, $2::jsonb, $3::numeric)`, JSON.stringify(snap), resp == null ? null : JSON.stringify(resp), max)).value;
    const multi = (mode) => ({ type: "MULTI", answer: { correct: ["a", "c"] }, scoring: { mode } });
    let x = await g(multi("PARTIAL"), { choices: ["a"] });
    let y = await g(multi("PARTIAL"), { choices: ["a", "b", "c", "d"] });
    let z = await g(multi("PARTIAL_PENALTY"), { choices: ["a", "b"] });
    let w = await g(multi("ALL_OR_NOTHING"), { choices: ["a"] });
    const full = await g(multi("PARTIAL"), { choices: ["c", "a"] });
    ok("Multiple responses: missing one, adding extras or mixing → 0, whatever mode was stored; exactly the right set → full", [x, y, z, w].every((v) => Number(v.score) === 0 && v.correct === false) && Number(full.score) === 2 && full.correct === true, JSON.stringify([x.score, y.score, z.score, w.score]));
    x = await g({ type: "ORDERING", answer: { order: ["a", "b", "c", "d"] }, scoring: { mode: "PARTIAL" } }, { order: ["a", "b", "d", "c"] }, 4);
    y = await g({ type: "MATCHING", answer: { pairs: { l1: "r1", l2: "r2", l3: "r3" } }, scoring: { mode: "PARTIAL" } }, { pairs: { l1: "r1", l2: "r3", l3: "r2" } }, 3);
    z = await g({ type: "NUMERIC", answer: { value: 5, tolerance: 0 } }, { value: 5.01 }, 1);
    w = await g({ type: "SHORT", answer: { accepted: ["CPI"], caseSensitive: true } }, { text: "cpi" }, 1);
    const blank = await g({ type: "MCQ", answer: { correct: ["a"] } }, null, 1);
    ok("Ordering with 2 of 4 in place → 0; matching with 1 of 3 pairs → 0; numeric outside tolerance → 0; case-sensitive short → 0; unanswered → 0", Number(x.score) === 0 && Number(y.score) === 0 && Number(z.score) === 0 && Number(w.score) === 0 && Number(blank.score) === 0 && blank.correct === false, JSON.stringify([x.score, y.score, z.score, w.score, blank.score]));

    // ── result / review policies ──
    await as(users.inst);
    const EM = await mk({ titleAr: "نتائج يدوية", resultsPolicy: "MANUAL", items: [{ questionId: qid.MCQ }], rules: [] });
    const EN = await mk({ titleAr: "بلا مراجعة", reviewPolicy: "NEVER", items: [{ questionId: qid.MCQ }], rules: [] });
    await as(users.l1);
    let am = (await j("exam_attempt_start", EM)).value.attemptId;
    r = await j("exam_attempt_submit", am);
    ok("Results policy MANUAL: after submitting, the score is hidden", r.value?.resultsVisible === false && r.value.score === null, JSON.stringify({ v: r.value?.resultsVisible, s: r.value?.score }));
    await as(users.inst);
    await j("exam_exam_release_results", EM);
    await as(users.l1);
    r = await j("exam_attempt_review", am);
    ok("…and visible once staff release the results", r.value?.resultsVisible === true && r.value.score !== null, "");
    am = (await j("exam_attempt_start", EN)).value.attemptId;
    r = await j("exam_attempt_submit", am);
    ok("Review policy NEVER: score shown, questions/answers not", r.value?.resultsVisible === true && r.value.reviewVisible === false && r.value.questions.length === 0, "");

    // ── resume policy + window ──
    await as(users.inst);
    const ENR = await mk({ titleAr: "بلا استكمال", resumePolicy: "NO_RESUME", items: [{ questionId: qid.MCQ }], rules: [] });
    await as(users.l1);
    const an = (await j("exam_attempt_start", ENR)).value.attemptId;
    await sql(`update public."ExamAttempt" set "lastSeenAt" = now() - interval '5 minutes' where "id"=$1`, an);
    r = await j("exam_attempt_state", an);
    ok("No-resume exam: leaving for more than 2 minutes closes the attempt (ABANDONED)", r.value?.status === "ABANDONED", r.value?.status);
    await as(users.inst);
    const EF = await mk({ titleAr: "مستقبلي", startsAt: new Date(Date.now() + 86400000).toISOString(), items: [{ questionId: qid.MCQ }], rules: [] });
    await as(users.l1);
    r = await j("exam_take_info", EF);
    ok("Exam not open yet → cannot start (not_open_yet)", r.value?.reason === "not_open_yet", r.value?.reason);

    // ── protection of exams / questions that have attempts ──
    await as(users.inst);
    await j("exam_exam_set_status", EA, "STOPPED");
    r = await j("exam_exam_set_status", EA, "DRAFT");
    ok("Exam with attempts cannot go back to draft", /exam_has_attempts/.test(r.error), r.error);
    await as(users.admin);
    r = await j("exam_bank_question_delete", sq[0]);
    ok("Question answered in an attempt cannot be deleted", /question_in_attempt/.test(r.error), r.error);

    throw ROLLBACK;
  }, { timeout: 240000 });
} catch (e) {
  if (e !== ROLLBACK) { console.error("✗ test run failed:", e.message); process.exitCode = 1; }
}

const [left] = await db.$queryRawUnsafe(`select (select count(*)::int from public."ExamMember" where "email" like '%@phase6.test') m, (select count(*)::int from public."ExamAttempt") a, (select count(*)::int from public."Exam") e, (select count(*)::int from public."Question") q`);
ok("Rollback: no test data left", JSON.stringify(left) === JSON.stringify(before), JSON.stringify({ before, left }));
await db.$disconnect();

for (const t of results) console.log(`${t.pass ? "✔" : "✗"} ${t.name}${t.pass ? "" : `  ← ${t.info}`}`);
const failed = results.filter((t) => !t.pass).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
if (failed) process.exitCode = 1;
