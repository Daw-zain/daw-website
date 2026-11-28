// Safe Exam Browser rules — run: npx tsx --env-file=.env scripts/test-exams-seb.ts
// The database part is one transaction, rolled back at the end: the real switch and keys are not changed.
// What SEB itself sends cannot be tested here: the proof is built the way its documentation describes.
import { PrismaClient } from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { configKey, platformSettings, sebFile, sebJson } from "./lib/seb-config";

const db = new PrismaClient();
const results: { name: string; pass: boolean; info: string }[] = [];
const ok = (name: string, pass: unknown, info = "") => results.push({ name, pass: !!pass, info });
const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");
const SITE = "https://site.test/base/";
const KEY = sha("a test configuration");

function fileTests() {
  const json = sebJson({ b: "x\\y", Zoo: [true, 2], apple: false, originatorVersion: "9", empty: {} });
  ok("SEB-JSON: keys sorted without regard to case, compact, nothing escaped, originatorVersion and empty groups left out", json === '{"apple":false,"b":"x\\y","Zoo":[true,2]}', json);
  const live = platformSettings("https://daw-zain.github.io/daw-website/");
  const file = readFileSync("public/seb/daleel.seb", "utf8").replace(/\r\n/g, "\n");
  ok("The published .seb file is the one these settings produce", file === sebFile(live), file.slice(0, 200));
  ok("The file starts the exam platform, offers the keys to the page and can be quit", live.startURL === "https://daw-zain.github.io/daw-website/ar/exams/" && live.browserWindowWebView === 3 && live.allowQuit === true);
  ok("A changed setting changes the Config Key", configKey(live) !== configKey({ ...live, allowQuit: false }) && /^[0-9a-f]{64}$/.test(configKey(live)));
}

async function databaseTests() {
  const ROLLBACK = new Error("rollback");
  const [course] = await db.$queryRawUnsafe<{ id: string }[]>(`select "id" from public."Program" p where not exists (select 1 from public."Question" q where q."programId"=p."id") order by p."order" limit 1`);
  const P = course.id;
  const u = (n: string) => ({ sub: randomUUID(), email: `t-${n}@seb.test` });
  const users = { admin: u("admin"), inst: u("inst"), helper: u("helper"), learner: u("learner"), second: u("second") };
  const before = await db.sebSetting.findUnique({ where: { id: "main" } });

  await db
    .$transaction(
      async (tx) => {
        const as = (x: { sub: string; email: string }) => tx.$executeRawUnsafe(`select set_config('request.jwt.claims', $1, true)`, JSON.stringify({ sub: x.sub, email: x.email, role: "authenticated" }));
        const headers = (h: Record<string, string> | string) => tx.$executeRawUnsafe(`select set_config('request.headers', $1, true)`, typeof h === "string" ? h : JSON.stringify(h));
        const browser = () => headers({});
        const seb = (url = `${SITE}ar/exams/take/?id=1`, key = KEY, load?: string) => headers({ "x-seb-hash": sha(url + key), "x-seb-url": url, ...(load ? { "x-seb-load-url": load } : {}) });
        const call = async (sql: string, ...args: unknown[]): Promise<{ value?: any; error: string }> => {
          await tx.$executeRawUnsafe("savepoint t");
          try {
            const r = await tx.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...args);
            await tx.$executeRawUnsafe("release savepoint t");
            return { value: Object.values(r[0] ?? {})[0], error: "" };
          } catch (e) {
            await tx.$executeRawUnsafe("rollback to savepoint t");
            return { error: String((e as { meta?: { message?: string } }).meta?.message ?? (e as Error).message) };
          }
        };
        const cast = (v: unknown) => (typeof v === "object" && v !== null ? "::jsonb" : typeof v === "boolean" ? "::boolean" : typeof v === "number" ? "::int" : "");
        const j = (fn: string, ...a: unknown[]) => call(`select public.${fn}(${a.map((v, i) => `$${i + 1}${cast(v)}`).join(",")})`, ...a.map((x) => (typeof x === "object" && x !== null ? JSON.stringify(x) : x)));

        for (const x of Object.values(users)) {
          await as(x);
          await call("select public.exam_me()");
        }
        await tx.$executeRawUnsafe(`update public."ExamMember" set "role"='ADMIN' where "email"=$1`, users.admin.email);
        // inside this transaction only: the switch off, one known key for a test address
        await tx.$executeRawUnsafe(`insert into public."SebSetting" ("id","updatedAt") values ('main', now()) on conflict ("id") do nothing`);
        await tx.$executeRawUnsafe(`update public."SebSetting" set "enabled"=false, "siteUrl"=$1, "configKeys"=array[$2] where "id"='main'`, SITE, KEY);

        await as(users.admin);
        await j("exam_admin_assign_instructor", P, users.inst.email, { canPublishExams: true });
        await j("exam_admin_assign_instructor", P, users.helper.email, { canPublishExams: false });
        await j("exam_admin_enroll", P, users.learner.email);
        await j("exam_admin_enroll", P, users.second.email);
        await as(users.inst);
        const q = (await j("exam_bank_question_save", P, { type: "TRUE_FALSE", status: "ACTIVE", stemAr: "عبارة", points: 1, answer: { value: true } })).value?.id;
        const folder = (await j("exam_course_folders", P)).value.find((f: { kind: string }) => f.kind === "DOMAIN_TESTS").id;
        const saved = await j("exam_exam_save", { folderId: folder, titleAr: "اختبار", maxAttempts: 5, passPercent: 60, items: [{ questionId: q }] });
        const E = saved.value?.id;
        const published = await j("exam_exam_publish", E);
        ok("A new exam asks for SEB by default", saved.value?.requireSeb === true && !published.error, saved.error + published.error);

        // ── switch off ──
        await as(users.learner);
        await browser();
        let r = await j("exam_take_info", E);
        ok("Switch off: nothing is required", r.value?.seb?.required === false, JSON.stringify(r.value?.seb) + r.error);
        r = await j("exam_attempt_start", E);
        const A = r.value?.attemptId;
        ok("Switch off: an exam starts in any browser", !!A, r.error);
        r = await j("exam_seb_save", { enabled: true });
        ok("A trainee cannot change the setting", /forbidden/.test(r.error), r.error);
        r = await j("exam_seb_status");
        ok("A trainee sees no keys", r.value?.canManage === false && r.value.configKeys === null && r.value.siteUrl === null, JSON.stringify(r.value));
        await as(users.inst);
        r = await j("exam_seb_save", { enabled: true });
        ok("A trainer cannot change the general setting", /forbidden/.test(r.error), r.error);
        await as(users.admin);
        r = await j("exam_seb_save", { configKeys: ["abc"] });
        ok("A malformed key is refused", /invalid_seb: key/.test(r.error), r.error);
        r = await j("exam_seb_save", { enabled: true, configKeys: [] });
        ok("It cannot be turned on without a key", /no_key/.test(r.error), r.error);
        r = await j("exam_seb_save", { enabled: true });
        ok("The super admin turns it on", r.value?.enabled === true, r.error);

        // ── switch on, normal browser ──
        await as(users.learner);
        await browser();
        r = await j("exam_take_info", E);
        ok("Switch on: the exam page says SEB is required and missing", r.value?.seb?.required === true && r.value.seb.ok === false, JSON.stringify(r.value?.seb));
        r = await j("exam_attempt_state", A);
        ok("A running attempt's questions are not sent to another browser", /seb_required/.test(r.error), r.error);
        r = await j("exam_attempt_save", A, "x", { value: true });
        ok("…nor are answers accepted from it", /seb_required/.test(r.error), r.error);
        r = await j("exam_attempt_start", E);
        ok("…and it cannot be resumed there", /seb_required/.test(r.error), r.error);
        await as(users.second);
        r = await j("exam_attempt_start", E);
        ok("A new exam cannot be started outside SEB", /seb_required/.test(r.error), r.error);

        // ── what counts as proof ──
        await headers({ "x-seb-hash": sha(`${SITE}ar/` + "another key"), "x-seb-url": `${SITE}ar/` });
        r = await j("exam_attempt_start", E);
        ok("A value from another configuration is refused", /seb_required/.test(r.error), r.error);
        await seb("https://evil.test/base/ar/");
        r = await j("exam_attempt_start", E);
        ok("A value for a page of another site is refused", /seb_required/.test(r.error), r.error);
        await headers({ "x-seb-hash": sha(`${SITE}one` + KEY), "x-seb-url": `${SITE}two` });
        r = await j("exam_attempt_start", E);
        ok("A value that does not belong to the sent address is refused", /seb_required/.test(r.error), r.error);
        await headers("not json");
        r = await j("exam_attempt_start", E);
        ok("Unreadable headers are refused, without an error leak", /seb_required/.test(r.error), r.error);
        await headers({ "x-seb-hash": sha(`${SITE}ar/exams/` + KEY).toUpperCase(), "x-seb-url": `${SITE}ar/exams/take/#x`, "x-seb-load-url": `${SITE}ar/exams/` });
        r = await j("exam_attempt_start", E);
        const B = r.value?.attemptId;
        ok("Inside SEB (signed first page, after moving inside the app): the exam starts", !!B, r.error);
        await seb(`${SITE}ar/exams/attempt/?id=${B}`);
        r = await j("exam_attempt_state", B);
        const question = r.value?.questions?.[0]?.id;
        ok("Inside SEB the questions arrive", !!question, r.error);
        r = await j("exam_attempt_save", B, question, { value: false });
        ok("Inside SEB answers are saved", r.value?.saved === true, r.error);
        await browser();
        r = await j("exam_attempt_submit", B);
        ok("Submitting and the result work in any browser (nothing is lost if SEB closes)", r.value?.status && r.value.status !== "IN_PROGRESS", r.error);

        // ── mistakes quiz ──
        r = await j("exam_mistakes_start", P, {});
        ok("The mistakes quiz also needs SEB", /seb_required/.test(r.error), r.error);
        await seb();
        r = await j("exam_mistakes_start", P, {});
        const S = r.value?.sessionId;
        ok("…and starts inside it", !!S, r.error);
        r = await j("exam_mistakes_state", S);
        const mq = r.value?.questions?.[0]?.id;
        await browser();
        r = await j("exam_mistakes_state", S);
        ok("An open mistakes quiz is not shown outside SEB", /seb_required/.test(r.error), r.error);
        r = await j("exam_mistakes_answer", S, mq, { value: true });
        ok("…nor answered", /seb_required/.test(r.error), r.error);

        // ── exemptions ──
        await as(users.inst);
        r = await j("exam_take_info", E);
        ok("Course staff are not asked for SEB", r.value?.seb?.required === false, JSON.stringify(r.value?.seb) + r.error);
        await as(users.second);
        r = await j("exam_seb_set_exam", E, false);
        ok("A trainee cannot switch an exam's requirement off", /forbidden/.test(r.error), r.error);
        await as(users.helper);
        r = await j("exam_seb_set_exam", E, false);
        ok("A trainer without the publish permission cannot either", /forbidden/.test(r.error), r.error);
        await as(users.inst);
        r = await j("exam_seb_set_exam", E, false);
        ok("A trainer who may publish switches it off, also while published", r.value?.requireSeb === false, r.error);
        await as(users.second);
        await browser();
        r = await j("exam_attempt_start", E);
        ok("That exam then starts in any browser", !!r.value?.attemptId, r.error);

        const priv = await tx.$queryRawUnsafe<Record<string, boolean>[]>(
          `select has_function_privilege('anon','public.exam_seb_status()','execute') a, has_function_privilege('anon','public.exam_seb_save(jsonb)','execute') b,
                  has_function_privilege('authenticated','public.exam_seb_proof()','execute') c, has_table_privilege('anon','public."SebSetting"','select') d,
                  has_table_privilege('authenticated','public."SebSetting"','update') e`,
        );
        ok("Visitors cannot call the functions; nobody reads or writes the settings table directly", Object.values(priv[0]).every((v) => v === false), JSON.stringify(priv[0]));
        throw ROLLBACK;
      },
      { timeout: 240_000, maxWait: 30_000 },
    )
    .catch((e) => {
      if (e !== ROLLBACK) throw e;
    });

  const after = await db.sebSetting.findUnique({ where: { id: "main" } });
  ok("The real switch and keys are untouched", JSON.stringify(before) === JSON.stringify(after), JSON.stringify(after));
}

async function main() {
  fileTests();
  await databaseTests();
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
    let fail = 0;
    for (const t of results) {
      if (!t.pass) fail++;
      console.log(`${t.pass ? "PASS" : "FAIL"}  ${t.name}${t.pass ? "" : `  →  ${t.info}`}`);
    }
    console.log(`\n${results.length - fail}/${results.length} passed`);
    if (fail) process.exitCode = 1;
  });
