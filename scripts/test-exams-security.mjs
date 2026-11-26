// Phase 8 (proctoring, warnings policy, rate limiting, security log) tests
// run: node --env-file=.env scripts/test-exams-security.mjs — one transaction, rolled back at the end.
// Inside one transaction now() does not move, so "time passing" between events is simulated by ageing rows.
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";

const db = new PrismaClient();
const PMP = "cmwx44kbb0001gvkwzr4kyo1l";
const CAPM = "cmwx44lbw0004gvkw5oretlpz";
const results = [];
const ok = (name, pass, info = "") => results.push({ name, pass, info });
const ROLLBACK = new Error("rollback");
const u = (n) => ({ sub: randomUUID(), email: `t-${n}@phase8.test` });
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
    const age = (attempt) => tx.$executeRawUnsafe(`update public."ProctorEvent" set "createdAt" = "createdAt" - interval '10 seconds' where "attemptId"=$1`, attempt);
    const ev = (attempt, kind) => j("exam_attempt_event", attempt, kind, "");

    for (const x of Object.values(users)) { await as(x); await call("select public.exam_me()"); }
    await tx.$executeRawUnsafe(`update public."ExamMember" set "role"='LEARNER' where "role"='ADMIN'`);
    await tx.$executeRawUnsafe(`update public."ExamMember" set "role"='ADMIN' where "email"=$1`, users.admin.email);
    await as(users.admin);
    await j("exam_admin_assign_instructor", PMP, users.inst.email, { canReopenAttempts: true, canPublishExams: true });
    await j("exam_admin_assign_instructor", PMP, users.noResults.email, { canViewResults: false });
    await j("exam_admin_assign_instructor", CAPM, users.capm.email, {});
    await j("exam_admin_enroll", PMP, users.l1.email);
    await j("exam_admin_enroll", PMP, users.l2.email);

    await as(users.inst);
    const q1 = (await j("exam_bank_question_save", PMP, { type: "TRUE_FALSE", stemAr: "س1", status: "ACTIVE", answer: { value: true } })).value.id;
    const DOM = (await j("exam_course_folders", PMP)).value.find((f) => f.kind === "DOMAIN_TESTS").id;
    const mk = async (title, security) => {
      const r = await j("exam_exam_save", { folderId: DOM, titleAr: title, durationMinutes: 30, items: [{ questionId: q1 }], security });
      return (await j("exam_exam_publish", r.value.id)).value.id;
    };
    const EW = await mk("تنبيه فقط", { detectBlur: true, maxWarnings: 2, onExceed: "WARN" });
    const ES = await mk("تسليم", { detectBlur: true, maxWarnings: 1, onExceed: "SUBMIT" });
    const ER = await mk("مراجعة", { detectBlur: true, maxWarnings: 1, onExceed: "REVIEW" });
    const EF = await mk("ملء الشاشة", { detectBlur: false, fullscreen: true, maxWarnings: 3, onExceed: "WARN" });

    // ── events: ownership + validation ──
    await as(users.l1);
    const AW = (await j("exam_attempt_start", EW)).value.attemptId;
    await as(users.l2);
    let r = await ev(AW, "HIDDEN");
    ok("Another learner cannot report events on this attempt", /not_found/.test(r.error), r.error);
    await as(users.l1);
    r = await ev(AW, "HACKED");
    ok("Unknown event kind → rejected", /invalid_event/.test(r.error), r.error);

    // ── WARN policy, de-duplication ──
    r = await ev(AW, "HIDDEN");
    ok("Leaving the page → warning 1 of 2", r.value?.counted === true && r.value.warnings === 1 && r.value.action === "warn", JSON.stringify(r.value));
    r = await ev(AW, "BLUR");
    ok("Blur fired together with it (within 3 s) is logged but not counted twice", r.value?.counted === false && r.value.warnings === 1, JSON.stringify(r.value));
    r = await ev(AW, "COPY");
    ok("Copy attempt is logged, not counted as a warning", r.value?.counted === false && r.value.warnings === 1, JSON.stringify(r.value));
    await age(AW);
    r = await ev(AW, "HIDDEN");
    await age(AW);
    r = await ev(AW, "HIDDEN");
    ok("WARN policy: 3 > 2 warnings → still only a warning, attempt continues", r.value?.warnings === 3 && r.value.action === "warn" && (await j("exam_attempt_state", AW)).value.status === "IN_PROGRESS", JSON.stringify(r.value));

    // ── SUBMIT policy ──
    const AS = (await j("exam_attempt_start", ES)).value.attemptId;
    await ev(AS, "HIDDEN");
    await age(AS);
    r = await ev(AS, "HIDDEN");
    ok("SUBMIT policy: exceeding the limit submits the attempt on the server", r.value?.action === "submitted", JSON.stringify(r.value));
    r = await j("exam_attempt_save", AS, (await call(`select "id" from public."AttemptQuestion" where "attemptId"=$1`, AS)).value, { value: true }, false);
    ok("…and further answers are refused", /attempt_closed/.test(r.error), r.error);

    // ── REVIEW policy ──
    const AR = (await j("exam_attempt_start", ER)).value.attemptId;
    const arq = (await call(`select "id" from public."AttemptQuestion" where "attemptId"=$1`, AR)).value;
    await ev(AR, "HIDDEN");
    await age(AR);
    r = await ev(AR, "HIDDEN");
    ok("REVIEW policy: attempt flagged but the learner can continue", r.value?.action === "review" && (await j("exam_attempt_save", AR, arq, { value: true }, false)).value?.saved === true, JSON.stringify(r.value));
    r = await j("exam_attempt_submit", AR);
    ok("Flagged attempt is held UNDER_REVIEW and its result is hidden", r.value?.status === "UNDER_REVIEW" && r.value.resultsVisible === false && r.value.score === null, JSON.stringify({ s: r.value?.status, v: r.value?.resultsVisible }));

    // ── full-screen monitoring ──
    const AF = (await j("exam_attempt_start", EF)).value.attemptId;
    r = await ev(AF, "BLUR");
    ok("With leave-detection off, blur is logged but not counted", r.value?.counted === false && r.value.warnings === 0, JSON.stringify(r.value));
    r = await ev(AF, "FULLSCREEN_EXIT");
    ok("Leaving required full screen counts as a warning", r.value?.counted === true && r.value.warnings === 1, JSON.stringify(r.value));

    // ── staff ──
    await as(users.noResults);
    r = await j("exam_attempt_events", AR);
    ok("Instructor without results permission cannot see an attempt's events", /forbidden/.test(r.error), r.error);
    r = await j("exam_security_log", 50);
    ok("…nor the security log", /forbidden/.test(r.error), r.error);
    await as(users.inst);
    r = await j("exam_attempt_events", AR);
    ok("Instructor sees the attempt's events with time and whether they counted", r.value?.length === 2 && r.value.every((e) => e.kind === "HIDDEN" && e.at), JSON.stringify(r.value?.map((e) => [e.kind, e.counted])));
    r = await j("exam_attempt_clear_review", AR, "راجعت السجل");
    ok("Instructor releases the held attempt → completed", r.value?.status === "COMPLETED" && r.value.reviewFlag === false, r.error ?? r.value?.status);
    await as(users.l1);
    r = await j("exam_attempt_review", AR);
    ok("…and the learner now sees the result", r.value?.resultsVisible === true && Number(r.value.score) === 1, JSON.stringify({ v: r.value?.resultsVisible, s: r.value?.score }));

    // ── rate limiting ──
    let firstRefused = 0;
    for (let i = 1; i <= 45; i++) {
      r = await j("exam_attempt_state", AW);
      if (r.error && !firstRefused) firstRefused = i;
    }
    // state was already called a few times above in this transaction, so the limit (40/min) is reached a bit earlier
    ok("Requests above the per-minute limit are refused (rate_limited)", firstRefused > 0 && /rate_limited/.test(r.error), `first refused at #${firstRefused}: ${r.error}`);
    const [logs] = await tx.$queryRawUnsafe(`select (select count(*)::int from public."ExamAuditLog" where "action"='security.rate_limit' and "details"->>'email'=$1) l, (select count(*)::int from public."Notification" where "type"='exam_security' and "body" like '%' || $1 || '%') n`, users.l1.email);
    ok("The excess is logged once and the admin is notified once (no flood)", logs.l === 1 && logs.n === 1, JSON.stringify(logs));
    await as(users.l2);
    r = await j("exam_take_info", EW);
    ok("Other users are not affected by someone else's limit", r.value?.canStart === true, r.error ?? "");
    r = await j("exam_security_log", 10);
    ok("Learners cannot read the security log", /forbidden/.test(r.error), r.error);

    // ── security log scope ──
    await as(users.admin);
    r = await j("exam_security_log", 100);
    const acts = (r.value?.events ?? []).map((e) => e.action);
    ok("Admin security log: rate limit, auto-submit, review flag and its release", ["security.rate_limit", "security.auto_submit", "security.review_flag", "security.review_cleared"].every((a) => acts.includes(a)), acts.join(","));
    ok("Admin sees attempts with warnings, most warnings first", r.value?.attempts?.[0]?.warnings === 3 && r.value.attempts.length >= 3, JSON.stringify(r.value?.attempts?.map((a) => a.warnings)));
    await as(users.capm);
    r = await j("exam_security_log", 100);
    ok("CAPM instructor's log contains nothing from PMP", (r.value?.events ?? []).every((e) => e.programId !== PMP) && (r.value?.attempts ?? []).length === 0, JSON.stringify({ e: r.value?.events?.length, a: r.value?.attempts?.length }));

    // ── bank extraction limit ──
    await as(users.inst);
    let bankRefused = 0;
    for (let i = 1; i <= 245; i++) {
      r = await j("exam_bank_question", q1);
      if (r.error) { bankRefused = i; break; }
    }
    ok("Mass reading of the question bank is throttled (240 per minute; the first excess call is let through so it can be logged)", bankRefused > 0 && bankRefused <= 242, `refused at #${bankRefused}`);

    throw ROLLBACK;
  }, { timeout: 300000 });
} catch (e) {
  if (e !== ROLLBACK) { console.error("✗ test run failed:", e.message); process.exitCode = 1; }
}

const [left] = await db.$queryRawUnsafe(`select (select count(*)::int from public."ExamMember" where "email" like '%@phase8.test') m, (select count(*)::int from public."ProctorEvent") p, (select count(*)::int from public."ExamRateLimit" where "key" like '%:%') r, (select count(*)::int from public."Notification" where "type"='exam_security') n, (select role from public."ExamMember" where "email"='training@aldaleel.ly') admin`);
ok("Rollback: no test data left; the real admin keeps the ADMIN role", left.m === 0 && left.p === 0 && left.n === 0 && left.admin === "ADMIN", JSON.stringify(left));
await db.$disconnect();

for (const t of results) console.log(`${t.pass ? "✔" : "✗"} ${t.name}${t.pass ? "" : `  ← ${t.info}`}`);
const failed = results.filter((t) => !t.pass).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
if (failed) process.exitCode = 1;
