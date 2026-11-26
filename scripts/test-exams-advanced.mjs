// Phase 10 (Hotspot, Drag & Drop, Cloze, graphic-based questions) tests
// run: node --env-file=.env scripts/test-exams-advanced.mjs — one transaction, rolled back at the end.
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";

const db = new PrismaClient();
// two courses without questions of their own, so real data never changes the expected numbers
const [PMP] = (await db.$queryRawUnsafe(`select "id" from public."Program" p where not exists (select 1 from public."Question" q where q."programId"=p."id") order by p."order" limit 2`)).map((r) => r.id);
const results = [];
const ok = (name, pass, info = "") => results.push({ name, pass, info });
const ROLLBACK = new Error("rollback");
const u = (n) => ({ sub: randomUUID(), email: `t-${n}@phase10.test` });
const users = { admin: u("admin"), inst: u("inst"), l1: u("l1") };

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
    const grade = async (snap, resp, max = 4) => (await call(`select public.exam_grade($1::jsonb, $2::jsonb, $3::numeric)`, JSON.stringify(snap), JSON.stringify(resp), max)).value;
    const respOk = async (pub, resp) => (await call(`select public.exam_response_ok($1::jsonb, $2::jsonb)`, JSON.stringify(pub), JSON.stringify(resp))).value;

    for (const x of Object.values(users)) { await as(x); await call("select public.exam_me()"); }
    await tx.$executeRawUnsafe(`update public."ExamMember" set "role"='LEARNER' where "role"='ADMIN'`);
    await tx.$executeRawUnsafe(`update public."ExamMember" set "role"='ADMIN' where "email"=$1`, users.admin.email);
    await as(users.admin);
    await j("exam_admin_assign_instructor", PMP, users.inst.email, { canPublishExams: true });
    await j("exam_admin_enroll", PMP, users.l1.email);
    await as(users.inst);

    const o = (...t) => t.map((x, i) => ({ id: `o${i + 1}`, textAr: x }));
    const save = (d) => j("exam_bank_question_save", PMP, { status: "DRAFT", points: 4, ...d });
    const err = (r) => r.error?.match(/invalid_question: ([a-z_0-9]+)/)?.[1] ?? r.error ?? "saved";

    // ── validation: HOTSPOT ──
    const HS = { type: "HOTSPOT", stemAr: "حدد المرحلة الحرجة على المخطط" };
    let r = await save({ ...HS, status: "ACTIVE", answer: {} });
    ok("ACTIVE hotspot without areas is refused", err(r) === "hotspot_regions_missing", err(r));
    r = await save({ ...HS, answer: { regions: [{ x: 90, y: 10, w: 20, h: 10 }] } });
    ok("Hotspot area outside the image is refused", err(r) === "hotspot_region_bad", err(r));
    r = await save({ ...HS, answer: { regions: [{ x: "10", y: 10, w: 20, h: 10 }] } });
    ok("Hotspot area with a non-number coordinate is refused", err(r) === "hotspot_region_bad", err(r));
    r = await save({ ...HS, answer: { regions: Array.from({ length: 11 }, () => ({ x: 1, y: 1, w: 5, h: 5 })) } });
    ok("More than 10 hotspot areas are refused", err(r) === "hotspot_regions_max_10", err(r));
    r = await save({ ...HS, status: "ACTIVE", answer: { regions: [{ x: 10, y: 10, w: 20, h: 20 }] } });
    ok("A hotspot cannot be ACTIVE before its image is attached", err(r) === "hotspot_image_missing", err(r));
    r = await save({ ...HS, answer: {} });
    const qDraftHS = r.value?.id;
    ok("A hotspot DRAFT may be saved before its areas exist (image is uploaded after the first save)", qDraftHS && r.value.answer.regions.length === 0, err(r));
    await j("exam_asset_register", "QUESTION", qDraftHS, `${PMP}/${qDraftHS}/${randomUUID()}.png`, "image/png", 1000, "x.png", "", "");
    r = await j("exam_bank_question_set_status", qDraftHS, "ACTIVE");
    ok("…but it cannot go ACTIVE without areas, even with its image", err(r) === "hotspot_regions_missing", err(r));
    r = await save({ ...HS, id: qDraftHS, status: "ACTIVE", answer: {} });
    ok("…nor be saved as ACTIVE without areas", err(r) === "hotspot_regions_missing", err(r));
    g0: {
      const g = await grade({ type: "HOTSPOT", scoring: { mode: "ALL_OR_NOTHING" }, answer: { regions: [] } }, { points: [{ x: 1, y: 1 }] });
      ok("Grading never gives marks against an empty hotspot key", Number(g.score) === 0 && g.correct === false, JSON.stringify(g));
      break g0;
    }
    r = await save({ ...HS, scoring: { mode: "PARTIAL_PENALTY" }, answer: { regions: [{ id: "a", x: 10, y: 10, w: 20, h: 20 }, { id: "b", x: 60, y: 50, w: 30, h: 30 }] } });
    const qHS = r.value?.id;
    ok("Hotspot saved as draft; areas live only in the secret answer", qHS && r.value.answer.regions.length === 2 && JSON.stringify(r.value.content) === "{}", err(r));
    r = await j("exam_bank_question_set_status", qHS, "ACTIVE");
    ok("…and still cannot be switched to ACTIVE without an image", err(r) === "hotspot_image_missing", err(r));
    const img = await j("exam_asset_register", "QUESTION", qHS, `${PMP}/${qHS}/${randomUUID()}.png`, "image/png", 1000, "chart.png", "المخطط", "");
    const pdf = await j("exam_asset_register", "QUESTION", qHS, `${PMP}/${qHS}/${randomUUID()}.pdf`, "application/pdf", 1000, "ref.pdf", "", "");
    r = await j("exam_bank_question_set_status", qHS, "ACTIVE");
    ok("With its image attached the hotspot goes ACTIVE", r.value?.status === "ACTIVE", err(r));
    r = await j("exam_asset_delete", img.value.id);
    ok("The only image of an ACTIVE hotspot cannot be deleted", /hotspot_image_needed/.test(r.error ?? ""), r.error ?? "deleted");

    // ── validation: DRAGDROP ──
    const DD = { type: "DRAGDROP", stemAr: "صنّف كل عملية في مجموعتها", content: { items: o("تطوير الميثاق", "تحديد النطاق", "قبول المخرجات", "مشتت"), zones: o("البدء", "التخطيط", "الإغلاق") } };
    r = await save({ ...DD, answer: { placements: {} } });
    ok("Drag & drop with no placements is refused", err(r) === "placements_missing", err(r));
    r = await save({ ...DD, answer: { placements: { o1: "o9" } } });
    ok("Drag & drop placement into an unknown zone is refused", err(r) === "placements_unknown_zone", err(r));
    r = await save({ ...DD, answer: { placements: { o7: "o1" } } });
    ok("Drag & drop placement of an unknown item is refused", err(r) === "placements_unknown_item", err(r));
    r = await save({ ...DD, status: "ACTIVE", scoring: { mode: "PARTIAL" }, answer: { placements: { o1: "o1", o2: "o2", o3: "o3" } } });
    const qDD = r.value?.id;
    ok("Drag & drop saved (item o4 is a distractor)", qDD && Object.keys(r.value.answer.placements).length === 3, err(r));

    // ── validation: CLOZE ──
    const CZ = {
      type: "CLOZE",
      stemAr: "أكمل الفراغات",
      content: { textAr: "تبدأ إدارة المشروع بمرحلة [[1]] وتنتهي بمرحلة [[2]].", textEn: "", blanks: [{ id: "1", kind: "SELECT", options: o("البدء", "التخطيط") }, { id: "2", kind: "TEXT" }] },
    };
    r = await save({ ...CZ, answer: { blanks: { 1: { correct: "o1" } } } });
    ok("Cloze: a typed blank without accepted answers is refused", err(r) === "cloze_blank_answer", err(r));
    r = await save({ ...CZ, answer: { blanks: { 1: { correct: "o9" }, 2: { accepted: ["الإغلاق"] } } } });
    ok("Cloze: a drop-down answer that is not one of its options is refused", err(r) === "cloze_blank_answer", err(r));
    r = await save({ ...CZ, content: { ...CZ.content, textAr: "نص بلا علامات" }, answer: { blanks: { 1: { correct: "o1" }, 2: { accepted: ["x"] } } } });
    ok("Cloze: a blank whose [[marker]] is missing from the text is refused", err(r) === "cloze_marker_missing", err(r));
    r = await save({ ...CZ, content: { ...CZ.content, textAr: CZ.content.textAr + " [[3]]" }, answer: { blanks: { 1: { correct: "o1" }, 2: { accepted: ["x"] } } } });
    ok("Cloze: a [[marker]] with no blank is refused", err(r) === "cloze_marker_unknown", err(r));
    r = await save({ ...CZ, content: { ...CZ.content, textAr: "[[1]] [[1]] [[2]]" }, answer: { blanks: { 1: { correct: "o1" }, 2: { accepted: ["x"] } } } });
    ok("Cloze: the same marker twice is refused", err(r) === "cloze_marker_missing", err(r));
    r = await save({ ...CZ, status: "ACTIVE", scoring: { mode: "PARTIAL" }, answer: { blanks: { 1: { correct: "o1" }, 2: { accepted: ["الإغلاق", "الاغلاق"] } } } });
    const qCZ = r.value?.id;
    ok("Cloze saved: options in content, answers only in the secret part", qCZ && !JSON.stringify(r.value.content).includes("accepted") && r.value.answer.blanks["2"].accepted.length === 2, err(r));

    // ── validation: graphic-based (figure on any type) ──
    const FIG = { kind: "BAR", captionAr: "التكلفة حسب الشهر", rows: [["الشهر", "مخطط", "فعلي"], ["1", "100", "120"], ["2", "200", "180"]] };
    r = await save({ type: "MCQ", stemAr: "أي شهر تجاوز الميزانية؟", content: { options: o("1", "2"), figure: { ...FIG, rows: [["a", "b"], ["x", "abc"]] } }, answer: { correct: ["o1"] } });
    ok("Chart with non-numeric values is refused", err(r) === "figure_not_numeric", err(r));
    r = await save({ type: "MCQ", stemAr: "س", content: { options: o("1", "2"), figure: { kind: "TABLE", rows: [["a", "b"], ["x"]] } }, answer: { correct: ["o1"] } });
    ok("Table with uneven rows is refused", err(r) === "figure_columns", err(r));
    r = await save({ type: "MCQ", stemAr: "س", content: { options: o("1", "2"), figure: { kind: "MAP", rows: [["a", "b"], ["x", "1"]] } }, answer: { correct: ["o1"] } });
    ok("Unknown figure kind is refused", err(r) === "figure_kind", err(r));
    r = await save({ type: "MCQ", status: "ACTIVE", stemAr: "أي شهر تجاوز الميزانية؟", content: { options: o("الشهر 1", "الشهر 2"), figure: FIG }, answer: { correct: ["o1"] } });
    const qFG = r.value?.id;
    ok("MCQ with a bar chart saved; figure kept in content and in the version snapshot", qFG && r.value.content.figure?.kind === "BAR" && r.value.content.figure.rows.length === 3, err(r));
    const [snapFig] = await tx.$queryRawUnsafe(`select "snapshot"->'content'->'figure'->>'kind' k from public."QuestionVersion" where "questionId"=$1 order by "version" desc limit 1`, qFG);
    ok("…version snapshot holds the figure", snapFig?.k === "BAR", JSON.stringify(snapFig));

    // ── grading (pure function) ──
    const hsSnap = { type: "HOTSPOT", scoring: { mode: "ALL_OR_NOTHING" }, answer: { regions: [{ id: "a", x: 10, y: 10, w: 20, h: 20 }, { id: "b", x: 60, y: 50, w: 30, h: 30 }] } };
    let g = await grade(hsSnap, { points: [{ x: 15, y: 15 }, { x: 70, y: 70 }] });
    ok("Hotspot: both areas marked → full marks", g.correct === true && Number(g.score) === 4, JSON.stringify(g));
    g = await grade(hsSnap, { points: [{ x: 15, y: 15 }, { x: 50, y: 5 }] });
    ok("Hotspot (all-or-nothing): one hit + one miss → 0", g.correct === false && Number(g.score) === 0, JSON.stringify(g));
    g = await grade({ ...hsSnap, scoring: { mode: "PARTIAL" } }, { points: [{ x: 15, y: 15 }] });
    ok("Hotspot (partial): one of two areas → half marks", Number(g.score) === 2, JSON.stringify(g));
    g = await grade({ ...hsSnap, scoring: { mode: "PARTIAL_PENALTY" } }, { points: [{ x: 15, y: 15 }, { x: 50, y: 5 }] });
    ok("Hotspot (penalty): one hit − one wrong mark → 0", Number(g.score) === 0, JSON.stringify(g));
    g = await grade({ ...hsSnap, scoring: { mode: "PARTIAL" } }, { points: [{ x: 15, y: 15 }, { x: 20, y: 20 }] });
    ok("Hotspot: two marks in the same area count once", Number(g.score) === 2 && g.correct === false, JSON.stringify(g));
    g = await grade(hsSnap, { points: [{ x: 10, y: 10 }, { x: 90, y: 80 }] });
    ok("Hotspot: marks exactly on the area edge count", g.correct === true, JSON.stringify(g));

    const ddSnap = { type: "DRAGDROP", scoring: { mode: "ALL_OR_NOTHING" }, answer: { placements: { i1: "z1", i2: "z2", i3: "z1" } } };
    g = await grade(ddSnap, { place: { i1: "z1", i2: "z2", i3: "z1" } });
    ok("Drag & drop: all items in the right zones → full marks", g.correct === true && Number(g.score) === 4, JSON.stringify(g));
    g = await grade(ddSnap, { place: { i1: "z1", i2: "z2", i3: "z1", i4: "z2" } });
    ok("Drag & drop: placing the distractor makes it not fully correct", g.correct === false && Number(g.score) === 0, JSON.stringify(g));
    g = await grade({ ...ddSnap, scoring: { mode: "PARTIAL" } }, { place: { i1: "z1", i2: "z1" } });
    ok("Drag & drop (partial): 1 of 3 right → 1.33", Number(g.score) === 1.33, JSON.stringify(g));
    g = await grade({ ...ddSnap, scoring: { mode: "PARTIAL" } }, { place: { i1: "z1", i2: "z2", i3: "z1", i4: "z1", i5: "z2", i6: "z1" } });
    ok("Drag & drop (partial): dumping every item into zones is diluted", Number(g.score) === 2, JSON.stringify(g));
    g = await grade({ ...ddSnap, scoring: { mode: "PARTIAL_PENALTY" } }, { place: { i1: "z1", i2: "z1", i3: "z1" } });
    ok("Drag & drop (penalty): 2 right − 1 wrong → 1.33", Number(g.score) === 1.33, JSON.stringify(g));

    const czSnap = { type: "CLOZE", scoring: { mode: "PARTIAL" }, answer: { blanks: { 1: { correct: "o1" }, 2: { accepted: ["Closing"], caseSensitive: false } } } };
    g = await grade({ ...czSnap, scoring: { mode: "ALL_OR_NOTHING" } }, { blanks: { 1: "o1", 2: "  closing " } });
    ok("Cloze: right option + typed answer (case/space-insensitive) → full marks", g.correct === true && Number(g.score) === 4, JSON.stringify(g));
    g = await grade(czSnap, { blanks: { 1: "o2", 2: "closing" } });
    ok("Cloze (partial): 1 of 2 blanks → half marks", Number(g.score) === 2 && g.correct === false, JSON.stringify(g));
    g = await grade({ ...czSnap, answer: { blanks: { 2: { accepted: ["Closing"], caseSensitive: true } } } }, { blanks: { 2: "closing" } });
    ok("Cloze: case-sensitive blank refuses the wrong case", Number(g.score) === 0, JSON.stringify(g));
    g = await grade(czSnap, null);
    ok("Unanswered advanced question scores 0", Number(g.score) === 0 && g.correct === false, JSON.stringify(g));

    // ── response shape (official attempt refuses malformed answers) ──
    const hsPub = { type: "HOTSPOT", selectCount: 2 };
    ok("Hotspot response: more marks than areas refused", (await respOk(hsPub, { points: [{ x: 1, y: 1 }, { x: 2, y: 2 }, { x: 3, y: 3 }] })) === false);
    ok("Hotspot response: coordinate outside 0–100 refused", (await respOk(hsPub, { points: [{ x: 101, y: 1 }] })) === false);
    ok("Hotspot response: well-formed marks accepted", (await respOk(hsPub, { points: [{ x: 12.5, y: 99 }] })) === true);
    const ddPub = { type: "DRAGDROP", items: [{ id: "i1" }, { id: "i2" }], zones: [{ id: "z1" }] };
    ok("Drag & drop response: unknown zone refused", (await respOk(ddPub, { place: { i1: "z9" } })) === false);
    ok("Drag & drop response: unknown item refused", (await respOk(ddPub, { place: { i9: "z1" } })) === false);
    ok("Drag & drop response: well-formed placement accepted", (await respOk(ddPub, { place: { i1: "z1", i2: "z1" } })) === true);
    const czPub = { type: "CLOZE", blanks: [{ id: "1", kind: "SELECT", options: [{ id: "o1" }] }, { id: "2", kind: "TEXT" }] };
    ok("Cloze response: option not shown for that blank refused", (await respOk(czPub, { blanks: { 1: "o7" } })) === false);
    ok("Cloze response: unknown blank refused", (await respOk(czPub, { blanks: { 9: "x" } })) === false);
    ok("Cloze response: over-long typed answer refused", (await respOk(czPub, { blanks: { 2: "x".repeat(201) } })) === false);
    ok("Cloze response: well-formed answer accepted", (await respOk(czPub, { blanks: { 1: "o1", 2: "Closing" } })) === true);

    // ── a real attempt with all three types + a chart question ──
    const DOM = (await j("exam_course_folders", PMP)).value.find((f) => f.kind === "DOMAIN_TESTS").id;
    const ex = await j("exam_exam_save", { folderId: DOM, titleAr: "أنواع متقدمة", durationMinutes: 30, maxAttempts: 3, shuffleOptions: true, items: [qHS, qDD, qCZ, qFG].map((questionId) => ({ questionId })) });
    const pub = await j("exam_exam_publish", ex.value.id);
    const EX = pub.value?.id;
    ok("Exam with advanced questions published", pub.value?.status === "PUBLISHED", ex.error ?? pub.error ?? JSON.stringify(pub.value));
    await as(users.l1);
    const started = await j("exam_attempt_start", EX);
    const A = started.value?.attemptId;
    ok("Learner starts the attempt", !!A, started.error ?? "");
    const st = (await j("exam_attempt_state", A)).value;
    const byType = Object.fromEntries((st?.questions ?? []).map((q) => [q.data.type, q.data]));
    const raw = JSON.stringify(st);
    ok("Learner view carries no areas, placements, accepted answers or correct options", !raw.includes("regions") && !raw.includes("placements") && !raw.includes("accepted") && !raw.includes('"correct"'), "");
    ok("Hotspot: learner gets the image to click + number of marks; the PDF stays as an attachment", byType.HOTSPOT?.hotspot?.kind === "IMAGE" && byType.HOTSPOT.selectCount === 2 && byType.HOTSPOT.images.length === 1 && byType.HOTSPOT.images[0].kind === "FILE", JSON.stringify(byType.HOTSPOT));
    ok("Drag & drop: learner gets all items (incl. distractor) and the zones", byType.DRAGDROP?.items?.length === 4 && byType.DRAGDROP.zones.length === 3, JSON.stringify(byType.DRAGDROP));
    ok("Cloze: learner gets the passage and blanks (options only for drop-downs)", byType.CLOZE?.textAr?.includes("[[1]]") && byType.CLOZE.blanks.length === 2 && byType.CLOZE.blanks[0].options?.length === 2 && !byType.CLOZE.blanks[1].options, JSON.stringify(byType.CLOZE));
    ok("Graphic-based: the chart reaches the learner with the question", byType.MCQ?.figure?.kind === "BAR" && byType.MCQ.figure.rows[1][2] === "120", JSON.stringify(byType.MCQ?.figure));

    r = await j("exam_attempt_save", A, await aq(A, qHS), { points: [{ x: 15, y: 15 }, { x: 70, y: 70 }, { x: 1, y: 1 }] }, false);
    ok("Official attempt refuses a hotspot answer with too many marks", /invalid_response/.test(r.error ?? ""), r.error ?? "saved");
    await j("exam_attempt_save", A, await aq(A, qHS), { points: [{ x: 15, y: 15 }, { x: 5, y: 95 }] }, false); // 1 hit, 1 wrong → penalty → 0
    await j("exam_attempt_save", A, await aq(A, qDD), { place: { o1: "o1", o2: "o2", o3: "o2" } }, false); // 2/3 partial → 2.67
    await j("exam_attempt_save", A, await aq(A, qCZ), { blanks: { 1: "o1", 2: "الاغلاق" } }, false); // full → 4
    await j("exam_attempt_save", A, await aq(A, qFG), { choice: "o1" }, false); // full → 4
    r = await j("exam_attempt_submit", A);
    const [att] = await tx.$queryRawUnsafe(`select "score"::text s, "maxScore"::text m, "status" from public."ExamAttempt" where "id"=$1`, A);
    ok("Attempt graded on the server: 0 + 2.67 + 4 + 4 = 10.67 / 16", Number(att.s) === 10.67 && Number(att.m) === 16 && att.status === "COMPLETED", JSON.stringify(att));
    const rv = (await j("exam_attempt_review", A)).value;
    const rvHS = rv?.questions?.find((q) => q.data.type === "HOTSPOT");
    ok("After submit the review shows the hotspot areas (exam allows showing the answer)", rvHS?.answer?.regions?.length === 2 && Number(rvHS.score) === 0, JSON.stringify(rvHS?.answer ?? rv));

    // ── mistakes quiz picks up the new types and grades them the same way ──
    const ov = (await j("exam_mistakes_overview", PMP, {})).value;
    ok("Wrong hotspot and partly-wrong drag & drop join the mistakes list", ov?.items?.some((x) => x.type === "HOTSPOT") && ov.items.some((x) => x.type === "DRAGDROP") && !ov.items.some((x) => x.type === "CLOZE"), JSON.stringify(ov?.items?.map((x) => x.type)));
    const hsItem = ov.items.find((x) => x.type === "HOTSPOT");
    const S = (await j("exam_mistakes_start", PMP, { ids: [hsItem.id] })).value?.sessionId;
    const ss = (await j("exam_mistakes_state", S)).value;
    ok("Mistakes session serves the hotspot image without the areas", ss?.questions?.[0]?.data?.hotspot?.kind === "IMAGE" && !JSON.stringify(ss).includes("regions"), "");
    r = await j("exam_mistakes_answer", S, ss.questions[0].id, { points: [{ x: 20, y: 20 }, { x: 75, y: 60 }] });
    ok("…and grades a correct retry as correct", r.value?.isCorrect === true, JSON.stringify(r.value ?? r.error));

    throw ROLLBACK;
  }, { timeout: 120000 });
} catch (e) {
  if (e !== ROLLBACK) {
    console.error(e);
    process.exitCode = 1;
  }
} finally {
  await db.$disconnect();
}

let fail = 0;
for (const t of results) {
  if (!t.pass) fail++;
  console.log(`${t.pass ? "PASS" : "FAIL"}  ${t.name}${t.pass ? "" : `  →  ${t.info}`}`);
}
console.log(`\n${results.length - fail}/${results.length} passed`);
if (fail) process.exitCode = 1;
