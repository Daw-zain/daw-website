// Phase 4 (scenarios + attachments) tests — run: node --env-file=.env scripts/test-exams-scenarios.mjs
// One transaction, rolled back at the end: nothing stays in the database.
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";

const db = new PrismaClient();
// two courses without questions of their own, so real data never changes the expected numbers
const [PMP, CAPM] = (await db.$queryRawUnsafe(`select "id" from public."Program" p where not exists (select 1 from public."Question" q where q."programId"=p."id") order by p."order" limit 2`)).map((r) => r.id);
const results = [];
const ok = (name, pass, info = "") => results.push({ name, pass, info });
const ROLLBACK = new Error("rollback");
const u = (n) => ({ sub: randomUUID(), email: `t-${n}@phase4.test` });
const users = { admin: u("admin"), inst: u("inst"), viewer: u("viewer"), capm: u("capm"), learner: u("learner") };
const tf = (stem, extra = {}) => ({ type: "TRUE_FALSE", stemAr: stem, status: "ACTIVE", answer: { value: true }, ...extra });

// what the same query finds before the test starts
const [before] = await db.$queryRawUnsafe(`select (select count(*)::int from public."ExamMember" where "email" like '%@phase4.test') m, (select count(*)::int from public."Scenario") s, (select count(*)::int from public."Question") q, (select count(*)::int from public."ExamAsset") a`);

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
    const scn = (program, s) => call("select public.exam_bank_scenario_save($1, $2::jsonb)", program, JSON.stringify(s));
    const qsave = (program, q) => call("select public.exam_bank_question_save($1, $2::jsonb)", program, JSON.stringify(q));
    const reg = (type, owner, path, mime = "image/png", size = 1000) => call("select public.exam_asset_register($1,$2,$3,$4,$5::int,'a.png','وصف','')", type, owner, path, mime, size);
    const can = (path, action) => call("select public.exam_storage_can($1, $2)", path, action);

    for (const x of Object.values(users)) { await as(x); await call("select public.exam_me()"); }
    await tx.$executeRawUnsafe(`update public."ExamMember" set "role"='ADMIN' where "email"=$1`, users.admin.email);
    await as(users.admin);
    await call("select public.exam_admin_assign_instructor($1,$2,'{}'::jsonb)", PMP, users.inst.email);
    await call("select public.exam_admin_assign_instructor($1,$2,$3::jsonb)", PMP, users.viewer.email, JSON.stringify({ canEditQuestions: false, canManageScenarios: false }));
    await call("select public.exam_admin_assign_instructor($1,$2,'{}'::jsonb)", CAPM, users.capm.email);
    await call("select public.exam_admin_enroll($1,$2)", PMP, users.learner.email);

    // ── scenarios ──
    await as(users.inst);
    const full = {
      titleAr: "مشروع توسعة المستودع", titleEn: "Warehouse expansion", bodyAr: "شركة لوجستية تخطط لتوسعة…", status: "ACTIVE", displayMode: "SIDE",
      details: { project: { ar: "الميزانية 2 مليون" }, risks: { ar: "تأخر التوريد", en: "Supply delay" }, unknownPart: { ar: "x" } },
      tables: [{ captionAr: "الجدول الزمني", rows: [["المرحلة", "المدة"], ["تصميم", "4 أسابيع"], ["تنفيذ", "12 أسبوعًا"]] }],
    };
    let r = await scn(PMP, full);
    const S1 = r.value?.id;
    ok("Instructor creates a scenario (version 1)", !!S1 && r.value.version === 1, r.error ?? "");
    ok("Unknown detail parts are dropped, known parts kept", r.value?.details?.risks?.en === "Supply delay" && !("unknownPart" in (r.value?.details ?? {})), JSON.stringify(r.value?.details));
    ok("Table stored with its rows", r.value?.tables?.[0]?.rows?.length === 3, "");
    for (const [name, s, re] of [
      ["no title", { ...full, titleAr: "", titleEn: "" }, /title_missing/],
      ["rows with different column counts", { ...full, tables: [{ rows: [["a", "b"], ["c"]] }] }, /table_columns/],
      ["empty table", { ...full, tables: [{ rows: [] }] }, /table_empty/],
      ["unknown display mode", { ...full, displayMode: "POPUP" }, /display_mode/],
    ]) {
      r = await scn(PMP, s);
      ok(`Scenario rejected: ${name}`, re.test(r.error ?? ""), r.error ?? "saved");
    }

    // ── linking questions (shared text stored once) ──
    const qids = [];
    for (let i = 1; i <= 6; i++) {
      r = await qsave(PMP, tf(`سؤال السيناريو ${i}`, { scenarioId: S1 }));
      qids.push(r.value?.id);
    }
    ok("Six questions linked, ordered 1..6", qids.every(Boolean) && r.value?.scenarioOrder === 6, r.error ?? `order ${r.value?.scenarioOrder}`);
    const [dup] = await tx.$queryRawUnsafe(`select count(*)::int n from public."Question" where "scenarioId"=$1 and "stemAr" like '%توسعة%'`, S1);
    ok("Scenario text is not copied into the questions", dup.n === 0, String(dup.n));
    r = await call("select public.exam_bank_scenario($1)", S1);
    ok("Scenario view lists its questions in order", r.value?.questions?.length === 6 && r.value.questions[0].stemAr.endsWith("1"), "");
    r = await call("select public.exam_bank_scenario_reorder($1, $2::jsonb)", S1, JSON.stringify([...qids].reverse()));
    ok("Reorder questions inside the scenario", r.value?.questions?.[0]?.id === qids[5], r.error ?? "");
    r = await call("select public.exam_bank_scenario_reorder($1, $2::jsonb)", S1, JSON.stringify(qids.slice(0, 3)));
    ok("Reorder with a missing question → refused", /reorder_mismatch/.test(r.error), r.error);
    r = await call("select public.exam_bank_questions($1, $2::jsonb)", PMP, JSON.stringify({ scenarioId: S1 }));
    ok("Bank list filtered by scenario", r.value?.total === 6 && r.value.items.every((i) => i.scenarioId === S1), "");
    await qsave(PMP, tf("سؤال مستقل"));
    r = await call("select public.exam_bank_questions($1, $2::jsonb)", PMP, JSON.stringify({ scenarioId: "none" }));
    ok("Bank list: questions without a scenario", r.value?.total === 1, String(r.value?.total));
    r = await call("select public.exam_bank_question_copy($1)", qids[0]);
    ok("Copying a scenario question keeps it in the scenario, at the end", r.value?.scenarioId === S1 && r.value.scenarioOrder === 7, JSON.stringify({ s: r.value?.scenarioOrder }));
    const copyId = r.value?.id;

    // second scenario + moving a question
    r = await scn(PMP, { titleAr: "سيناريو ثانٍ" });
    const S2 = r.value?.id;
    r = await qsave(PMP, { ...tf("سؤال السيناريو 1"), id: qids[0], scenarioId: S2 });
    ok("Moving a question to another scenario puts it at the end there", r.value?.scenarioId === S2 && r.value.scenarioOrder === 1, "");
    await as(users.capm);
    r = await scn(CAPM, { titleAr: "سيناريو CAPM" });
    const SC = r.value?.id;
    await as(users.inst);
    r = await qsave(PMP, tf("x", { scenarioId: SC }));
    ok("Linking a PMP question to a CAPM scenario → refused", /invalid_question: scenario/.test(r.error), r.error);

    // versions
    r = await scn(PMP, { ...full, id: S1, bodyAr: "نص معدل" });
    const [sv] = await tx.$queryRawUnsafe(`select count(*)::int n, min("snapshot"->>'bodyAr') old from public."ScenarioVersion" where "scenarioId"=$1`, S1);
    ok("Editing a scenario → version 2, old snapshot kept", r.value?.version === 2 && sv.n === 2, JSON.stringify(sv));

    // ── who is refused ──
    await as(users.viewer);
    r = await call("select public.exam_bank_scenario($1)", S1);
    ok("View-only instructor can read scenarios", r.value?.id === S1, r.error ?? "");
    r = await scn(PMP, { titleAr: "x" });
    ok("Instructor without scenario permission → save refused", /forbidden/.test(r.error), r.error);
    await as(users.capm);
    r = await call("select public.exam_bank_scenarios($1, '{}'::jsonb)", PMP);
    ok("CAPM instructor → PMP scenarios refused", /forbidden/.test(r.error), r.error);
    r = await call("select public.exam_bank_scenario($1)", S1);
    ok("CAPM instructor → PMP scenario by id refused", /forbidden/.test(r.error), r.error);
    await as(users.learner);
    r = await call("select public.exam_bank_scenario($1)", S1);
    ok("Enrolled learner → scenario (with its questions) refused", /forbidden/.test(r.error), r.error);

    // ── delete policy ──
    await as(users.inst);
    r = await call("select public.exam_bank_scenario_delete($1)", S1);
    ok("Scenario with linked questions cannot be deleted", /scenario_in_use/.test(r.error), r.error);

    // ── attachments ──
    const qA = qids[1];
    const good = `${PMP}/${qA}/${randomUUID()}.png`;
    r = await reg("QUESTION", qA, good);
    const A1 = r.value?.id;
    ok("Register an image for a question", r.value?.kind === "IMAGE" && r.value.path === good, r.error ?? "");
    r = await reg("SCENARIO", S1, `${PMP}/${S1}/${randomUUID()}.pdf`, "application/pdf", 5000);
    ok("Register a PDF for a scenario", r.value?.kind === "FILE", r.error ?? "");
    for (const [name, path, mime, size, re] of [
      ["path of another course", `${CAPM}/${qA}/${randomUUID()}.png`, "image/png", 10, /invalid_asset: path/],
      ["path of another question", `${PMP}/${qids[2]}/${randomUUID()}.png`, "image/png", 10, /invalid_asset: path/],
      ["path traversal", `${PMP}/${qA}/../x.png`, "image/png", 10, /invalid_asset: path/],
      ["SVG (can carry scripts)", `${PMP}/${qA}/${randomUUID()}.png`, "image/svg+xml", 10, /invalid_asset: type/],
      ["file over 10 MB", `${PMP}/${qA}/${randomUUID()}.png`, "image/png", 10485761, /invalid_asset: size/],
    ]) {
      r = await reg("QUESTION", qA, path, mime, size);
      ok(`Attachment rejected: ${name}`, re.test(r.error ?? ""), r.error ?? "registered");
    }
    r = await call("select public.exam_assets('QUESTION', $1)", qA);
    ok("Staff list a question's attachments", r.value?.length === 1 && !("programId" in r.value[0]), "");
    await as(users.viewer);
    r = await reg("QUESTION", qA, `${PMP}/${qA}/${randomUUID()}.png`);
    ok("View-only instructor cannot add attachments", /forbidden/.test(r.error), r.error);
    await as(users.learner);
    r = await call("select public.exam_assets('QUESTION', $1)", qA);
    ok("Learner cannot list attachments", /forbidden/.test(r.error), r.error);

    // storage policy helper (what Supabase Storage asks before every read / upload / delete)
    const p = `${PMP}/${qA}/x.png`;
    const checks = [
      ["admin", "read", true], ["admin", "write", true],
      ["inst", "read", true], ["inst", "write", true],
      ["viewer", "read", true], ["viewer", "write", false],
      ["capm", "read", false], ["capm", "write", false],
      ["learner", "read", false], ["learner", "write", false],
    ];
    const got = [];
    for (const [who, action, expect] of checks) {
      await as(users[who]);
      r = await can(p, action);
      got.push(r.value === expect ? "" : `${who}/${action}=${r.value ?? r.error}`);
    }
    await as(null);
    r = await can(p, "read");
    ok("Storage access: staff read, editors write; other course, learner, no session refused", got.join("") === "" && r.value === false, got.filter(Boolean).join(" ") + ` anon=${r.value}`);

    // deleting a question returns its file paths (the browser removes them from Storage) and drops the rows
    await as(users.admin);
    r = await call("select public.exam_bank_question_delete($1)", qA);
    const [left] = await tx.$queryRawUnsafe(`select count(*)::int n from public."ExamAsset" where "ownerId"=$1`, qA);
    ok("Question delete returns attachment paths and removes their records", r.value?.paths?.[0] === good && left.n === 0, JSON.stringify(r.value));
    r = await call("select public.exam_asset_delete($1)", A1);
    ok("Deleting an already removed attachment → not found", /not_found/.test(r.error), r.error);

    // unlink the rest, then the scenario can go (with its attachment records)
    for (const id of [...qids.slice(2), copyId]) await qsave(PMP, { ...tf("x"), id, scenarioId: null });
    r = await call("select public.exam_bank_scenario_delete($1)", S1);
    ok("After unlinking, the scenario is deleted and its file paths returned", r.value?.deleted === S1 && r.value.paths.length === 1, r.error ?? JSON.stringify(r.value));

    throw ROLLBACK;
  }, { timeout: 120000 });
} catch (e) {
  if (e !== ROLLBACK) { console.error("✗ test run failed:", e.message); process.exitCode = 1; }
}

const [left] = await db.$queryRawUnsafe(`select (select count(*)::int from public."ExamMember" where "email" like '%@phase4.test') m, (select count(*)::int from public."Scenario") s, (select count(*)::int from public."Question") q, (select count(*)::int from public."ExamAsset") a`);
ok("Rollback: no test data left", JSON.stringify(left) === JSON.stringify(before), JSON.stringify({ before, left }));
await db.$disconnect();

for (const t of results) console.log(`${t.pass ? "✔" : "✗"} ${t.name}${t.pass ? "" : `  ← ${t.info}`}`);
const failed = results.filter((t) => !t.pass).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
if (failed) process.exitCode = 1;
