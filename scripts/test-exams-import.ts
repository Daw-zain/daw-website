// Phase 11 — import / export on the database. run: npx tsx --env-file=.env scripts/test-exams-import.ts
// One transaction, rolled back at the end. Uses the real file readers so the whole path is exercised.
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { exportAs, parseFile, TEMPLATES, type ExportQuestion, type ImportQuestion } from "../src/lib/exams/io";

const db = new PrismaClient();
const PMP = "cmwx44kbb0001gvkwzr4kyo1l";
const CAPM = "cmwx44lbw0004gvkw5oretlpz";
const results: { name: string; pass: boolean; info: string }[] = [];
const ok = (name: string, pass: boolean, info = "") => results.push({ name, pass, info });
const ROLLBACK = new Error("rollback");
const u = (n: string) => ({ sub: randomUUID(), email: `t-${n}@phase11.test` });
const users = { admin: u("admin"), inst: u("inst"), noImport: u("noimport"), noCat: u("nocat"), learner: u("learner") };
type R = { value?: any; error?: string };

async function main() {
  try {
    await db.$transaction(
      async (tx) => {
        const as = (x: { sub: string; email: string }) => tx.$executeRawUnsafe(`select set_config('request.jwt.claims', $1, true)`, JSON.stringify({ sub: x.sub, email: x.email, role: "authenticated" }));
        const call = async (sql: string, ...args: unknown[]): Promise<R> => {
          await tx.$executeRawUnsafe("savepoint t");
          try {
            const r = (await tx.$queryRawUnsafe(sql, ...args)) as Record<string, unknown>[];
            await tx.$executeRawUnsafe("release savepoint t");
            return { value: Object.values(r[0] ?? {})[0] };
          } catch (e) {
            await tx.$executeRawUnsafe("rollback to savepoint t");
            return { error: String((e as { meta?: { message?: string } }).meta?.message ?? (e as Error).message) };
          }
        };
        const check = (items: unknown[], opts: object = {}) => call(`select public.exam_bank_import_check($1, $2::jsonb, $3::jsonb)`, PMP, JSON.stringify(items), JSON.stringify(opts));
        const imp = (items: unknown[], opts: object = {}) => call(`select public.exam_bank_import($1, $2::jsonb, $3::jsonb)`, PMP, JSON.stringify(items), JSON.stringify(opts));
        const exp = (filter: object = {}) => call(`select public.exam_bank_export($1, $2::jsonb)`, PMP, JSON.stringify(filter));
        const count = async () => Number(((await tx.$queryRawUnsafe(`select count(*)::int n from public."Question" where "programId"=$1`, PMP)) as { n: number }[])[0].n);

        for (const x of Object.values(users)) {
          await as(x);
          await call("select public.exam_me()");
        }
        await tx.$executeRawUnsafe(`update public."ExamMember" set "role"='LEARNER' where "role"='ADMIN'`);
        await tx.$executeRawUnsafe(`update public."ExamMember" set "role"='ADMIN' where "email"=$1`, users.admin.email);
        await as(users.admin);
        await call(`select public.exam_admin_assign_instructor($1, $2, $3::jsonb)`, PMP, users.inst.email, JSON.stringify({ canImport: true, canExport: true, canManageCategories: true, canManageScenarios: true }));
        await call(`select public.exam_admin_assign_instructor($1, $2, $3::jsonb)`, PMP, users.noImport.email, JSON.stringify({ canImport: false, canExport: false }));
        await call(`select public.exam_admin_assign_instructor($1, $2, $3::jsonb)`, PMP, users.noCat.email, JSON.stringify({ canImport: true, canManageCategories: false, canManageScenarios: false }));
        await call(`select public.exam_admin_enroll($1, $2)`, PMP, users.learner.email);

        const gift = (await parseFile("gift", { text: TEMPLATES.gift.text() }, "auto")).questions.map((p) => p.q);
        const csv = (await parseFile("csv", { text: TEMPLATES.csv.text() }, "auto")).questions.map((p) => p.q);
        const before = await count();

        // ── permissions ──
        await as(users.noImport);
        let r = await check(gift);
        ok("Instructor without import permission cannot import (preview or real)", /forbidden/.test(r.error ?? "") && /forbidden/.test((await imp(gift)).error ?? ""), r.error ?? "");
        ok("…nor export", /forbidden/.test((await exp()).error ?? ""), "");
        await as(users.learner);
        ok("Learner cannot import or export", /forbidden/.test((await check(gift)).error ?? "") && /forbidden/.test((await exp()).error ?? ""), "");

        // ── preview (dry run) ──
        await as(users.inst);
        const broken: ImportQuestion = { ...gift[0], stemAr: "سؤال معطوب الإجابة", answer: { correct: ["nope"] } };
        const withId = { ...gift[2], id: "someone-elses-id" };
        r = await check([...gift, broken, gift[0], withId]);
        const items = r.value?.items ?? [];
        ok("Preview validates with the editor's rules: 7 GIFT questions valid, the broken one refused with its reason", r.value?.counts?.valid === 9 && items[7]?.ok === false && /correct_unknown_option/.test(items[7]?.error ?? ""), JSON.stringify(r.value?.counts ?? r.error) + items[7]?.error);
        ok("Preview spots a duplicate inside the file", items[8]?.duplicateInFile === 0, JSON.stringify(items[8]));
        ok("Preview keeps nothing (dry run is rolled back)", (await count()) === before, String(await count()));
        ok("Preview reports a category name the course does not have", JSON.stringify(items[0]?.categoryMissing) === '["البدء"]', JSON.stringify(items[0]?.categoryMissing));
        ok("Preview tells the UI whether categories / scenarios may be created", r.value?.can?.categories === true && r.value?.can?.scenarios === true, JSON.stringify(r.value?.can));

        // ── import: one failure does not spoil the rest ──
        r = await imp([gift[0], broken, gift[1], withId], { createCategories: true, format: "gift", fileName: "t.gift" });
        const res = r.value?.results ?? [];
        ok("Import: good questions in, the broken one fails alone with its reason", r.value?.counts?.imported === 3 && r.value.counts.failed === 1 && res[1]?.ok === false && /correct_unknown_option/.test(res[1]?.error ?? ""), JSON.stringify(r.value?.counts ?? r.error));
        ok("…an id in the file never overwrites an existing question (always a new one)", res[3]?.ok && res[3].id !== "someone-elses-id", JSON.stringify(res[3]));
        const [q0] = (await tx.$queryRawUnsafe(`select q."status", q."domainId", c."nameAr" from public."Question" q left join public."QuestionCategory" c on c."id"=q."domainId" where q."id"=$1`, res[0].id)) as { status: string; domainId: string; nameAr: string }[];
        ok("…imported as DRAFT by default; missing category «البدء» created and used", q0?.status === "DRAFT" && q0.nameAr === "البدء" && r.value.counts.categoriesCreated === 1, JSON.stringify(q0));
        const [sec] = (await tx.$queryRawUnsafe(`select "feedbackAr", "answer" from public."QuestionSecret" where "questionId"=$1`, res[0].id)) as { feedbackAr: string; answer: unknown }[];
        ok("…feedback kept, answer stored in the secret part", sec?.feedbackAr === "الميثاق يخوّل المشروع رسميًا." && !!sec.answer, JSON.stringify(sec));
        const [vers] = (await tx.$queryRawUnsafe(`select count(*)::int n from public."QuestionVersion" where "questionId"=$1`, res[0].id)) as { n: number }[];
        ok("…version 1 snapshot written like any editor save", vers.n === 1, String(vers.n));
        const [log] = (await tx.$queryRawUnsafe(`select "details" from public."ExamAuditLog" where "action"='question.import' order by "createdAt" desc limit 1`)) as { details: { imported: number; failed: number; file: string } }[];
        ok("…one audit entry with counts and file name", log?.details?.imported === 3 && log.details.failed === 1 && log.details.file === "t.gift", JSON.stringify(log));

        // duplicates
        r = await imp([gift[0], gift[3]]);
        ok("Re-importing an existing question is skipped as a duplicate (default)", r.value?.counts?.skipped === 1 && r.value.counts.imported === 1 && r.value.results[0].error === "duplicate", JSON.stringify(r.value?.counts));
        r = await imp([gift[0]], { skipDuplicates: false });
        ok("…unless duplicates are explicitly allowed", r.value?.counts?.imported === 1, JSON.stringify(r.value?.counts));
        r = await check([{ ...gift[0], stemAr: "  ما   المُخرج الرئيسي لعملية تطوير ميثاق المشروع ؟" }]);
        ok("Duplicate check ignores spacing, diacritics and punctuation", !!r.value?.items?.[0]?.duplicateOf, JSON.stringify(r.value?.items?.[0]));

        // status / category defaults / hotspot
        const DOM = ((await tx.$queryRawUnsafe(`select "id" from public."QuestionCategory" where "programId"=$1 and "nameAr"='البدء'`, PMP)) as { id: string }[])[0].id;
        const hs: ImportQuestion = { ...gift[0], type: "HOTSPOT", stemAr: "حدد على الصورة", content: {}, answer: { regions: [{ id: "a", x: 1, y: 1, w: 10, h: 10 }] }, optionRationale: {}, category: undefined };
        r = await imp([{ ...csv[2], stemAr: "عبارة صح أو خطأ جديدة", category: undefined }, hs], { status: "ACTIVE", domainId: DOM });
        const st = (await tx.$queryRawUnsafe(`select "type", "status", "domainId" from public."Question" where "id" = any($1::text[]) order by "type"`, r.value?.results?.map((x: { id: string }) => x.id) ?? [])) as { type: string; status: string; domainId: string }[];
        ok("Import as ACTIVE into the chosen domain; a hotspot still arrives as DRAFT (its image comes later)", st.length === 2 && st.find((x) => x.type === "TRUE_FALSE")?.status === "ACTIVE" && st.find((x) => x.type === "HOTSPOT")?.status === "DRAFT" && st.every((x) => x.domainId === DOM), JSON.stringify(st));

        // permission to create categories / scenarios
        await as(users.noCat);
        const scen = { key: "S1", titleAr: "حالة مشروع", titleEn: "", bodyAr: "نص الحالة", bodyEn: "" };
        r = await imp([{ ...csv[0], stemAr: "سؤال بتصنيف جديد", category: { domain: "مجال غير موجود" } }, { ...csv[1], stemAr: "سؤال بسيناريو", scenario: scen }], { createCategories: true });
        const w = r.value?.results ?? [];
        ok("Without category / scenario permission: questions still imported, with warnings, nothing extra created", r.value?.counts?.imported === 2 && r.value.counts.categoriesCreated === 0 && r.value.counts.scenariosCreated === 0 && w[0].warnings.includes("category_missing") && w[1].warnings.includes("scenario_skipped"), JSON.stringify(r.value));
        await as(users.inst);
        r = await imp([{ ...csv[3], stemAr: "سؤال 1 في الحالة", scenario: scen }, { ...csv[4], stemAr: "سؤال 2 في الحالة", scenario: scen }]);
        const sids = (await tx.$queryRawUnsafe(`select distinct "scenarioId" from public."Question" where "id" = any($1::text[])`, r.value?.results?.map((x: { id: string }) => x.id) ?? [])) as { scenarioId: string }[];
        ok("JSON scenario: created once and shared by its questions", r.value?.counts?.scenariosCreated === 1 && sids.length === 1 && !!sids[0].scenarioId, JSON.stringify(r.value?.counts));
        r = await imp([{ ...csv[3], stemAr: "سؤال في حالة فاشل", scenario: scen, answer: { value: "x" } }, { ...csv[4], stemAr: "سؤال تالٍ في الحالة نفسها", scenario: scen }]);
        ok("A failed question does not leave a half-created scenario behind; the next one still gets it", r.value?.counts?.failed === 1 && r.value.counts.imported === 1 && r.value.counts.scenariosCreated === 1, JSON.stringify(r.value?.counts));

        r = await check(Array.from({ length: 501 }, () => gift[0]));
        ok("More than 500 questions in one call are refused (the UI sends batches)", /max_500/.test(r.error ?? ""), r.error ?? "");

        // ── export ──
        r = await exp({ format: "json" });
        const all = (r.value?.questions ?? []) as ExportQuestion[];
        ok("Export of the whole bank: full questions with answers, feedback, category names, scenario, attachments list", all.length === (await count()) && all.some((q) => q.feedbackAr) && all.some((q) => q.category?.domain === "البدء") && all.some((q) => q.scenario?.titleAr === "حالة مشروع") && all.every((q) => Array.isArray(q.attachments)), String(all.length));
        r = await exp({ categoryId: DOM });
        ok("Export of one category", r.value?.questions?.length > 0 && r.value.questions.every((q: ExportQuestion) => q.category?.domain === "البدء"), String(r.value?.questions?.length));
        const pick = all.slice(0, 2).map((q) => q.id);
        r = await exp({ ids: pick });
        ok("Export of a selected set", r.value?.questions?.length === 2, String(r.value?.questions?.length));
        const [elog] = (await tx.$queryRawUnsafe(`select "details" from public."ExamAuditLog" where "action"='question.export' and "details"->>'scope'='selection' order by "createdAt" desc limit 1`)) as { details: { count: number; scope: string } }[];
        ok("Every export is written to the audit log (count + scope)", elog?.details?.count === 2 && elog.details.scope === "selection", JSON.stringify(elog));
        await as(users.admin);
        r = await call(`select public.exam_bank_export($1, '{}'::jsonb)`, CAPM);
        ok("Admin can export any course; another course's export holds none of this course's questions", Array.isArray(r.value?.questions) && !r.value.questions.some((q: ExportQuestion) => all.some((a) => a.id === q.id)), r.error ?? "");

        // ── full circle: export from this course → Moodle XML → parse → import into another course ──
        const xml = exportAs("moodle", all, "ar", {});
        const parsed = (await parseFile("moodle", { text: xml.text }, "auto")).questions.map((p) => p.q);
        r = await call(`select public.exam_bank_import($1, $2::jsonb, '{"createCategories": true, "skipDuplicates": false}'::jsonb)`, CAPM, JSON.stringify(parsed));
        ok("Exported Moodle XML imports cleanly into another course (all exportable questions, nothing failed)", r.value?.counts?.imported === xml.exported && r.value.counts.failed === 0, JSON.stringify(r.value?.counts ?? r.error) + ` exported=${xml.exported} skipped=${xml.skipped.length}`);

        throw ROLLBACK;
      },
      { timeout: 180000 },
    );
  } catch (e) {
    if (e !== ROLLBACK) {
      console.error(e);
      process.exitCode = 1;
    }
  } finally {
    await db.$disconnect();
  }
}

main().finally(() => {
  let fail = 0;
  for (const t of results) {
    if (!t.pass) fail++;
    console.log(`${t.pass ? "PASS" : "FAIL"}  ${t.name}${t.pass ? "" : `  →  ${t.info}`}`);
  }
  console.log(`\n${results.length - fail}/${results.length} passed`);
  if (fail) process.exitCode = 1;
});
