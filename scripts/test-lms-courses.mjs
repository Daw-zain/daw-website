// Course management: course data, files, videos, progress and who may see them.
// run: node --env-file=.env scripts/test-lms-courses.mjs — one transaction, rolled back at the end.
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";

const db = new PrismaClient();
const ROLLBACK = new Error("rollback");
const results = [];
const ok = (name, pass, info = "") => results.push({ name, pass: !!pass, info });
const u = (n) => ({ sub: randomUUID(), email: `t-${n}@courses.test` });
const users = { boss: u("boss"), staff: u("staff"), reader: u("reader"), empty: u("empty"), inst: u("inst"), helper: u("helper"), stud: u("stud"), other: u("other"), none: u("none"), expired: u("expired") };
const denied = (r) => /forbidden|super_admin_only|cannot_grant/.test(r.error ?? "");

const countSql = `select (select count(*)::int from public."Program") p, (select count(*)::int from public."ExamMember") m, (select count(*)::int from public."CourseItem") i,
  (select count(*)::int from public."CourseFolder") f, (select count(*)::int from public."ContentProgress") pr, (select count(*)::int from public."Enrollment") e,
  (select md5(string_agg(p."slug" || p."published"::text || p."titleAr" || p."updatedAt"::text, ',' order by p."slug")) from public."Program" p) programs`;
const [before] = await db.$queryRawUnsafe(countSql);

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
    const cast = (v) => (v === null ? "::text" : typeof v === "object" ? "::jsonb" : typeof v === "boolean" ? "::boolean" : typeof v === "number" ? "::int" : "");
    const j = (fn, ...a) => call(`select public.${fn}(${a.map((v, i) => `$${i + 1}${cast(v)}`).join(",")})`, ...a.map((x) => (typeof x === "object" && x !== null ? JSON.stringify(x) : x)));
    const v = (fn, ...a) => j(fn, ...a).then((r) => { if (r.error) throw new Error(`${fn}: ${r.error}`); return r.value; });
    const run = (fn, ...a) => call(`select public.${fn}(${a.map((x, i) => `$${i + 1}${cast(x)}`).join(",")})::text`, ...a);
    const member = async (x) => (await tx.$queryRawUnsafe(`select * from public."ExamMember" where "email"=$1`, x.email))[0];
    const can = async (name, mode) => (await v("exam_course_file_can", name, mode)) === true;
    const file = (program, ext = "pdf", extra = {}) => ({ source: "FILE", filePath: `${program}/${randomUUID()}.${ext}`, fileName: `f.${ext}`, mimeType: ext === "pdf" ? "application/pdf" : ext === "mp4" ? "video/mp4" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document", size: 1000, ...extra });

    for (const x of Object.values(users)) { await as(x); await v("exam_me"); }
    await tx.$executeRawUnsafe(`update public."ExamMember" set "role"='LEARNER' where "role"='ADMIN'`);
    await tx.$executeRawUnsafe(`update public."ExamMember" set "role"='ADMIN' where "email"=$1`, users.boss.email);
    await as(users.boss);

    // ── roles ──
    const roles = await v("exam_roles");
    ok("The catalogue has a courses section", JSON.stringify(roles.catalogue.courses) === JSON.stringify(["read", "create", "update", "content"]), roles.catalogue.courses);
    const builtIn = roles.roles.find((r) => r.key === "admin");
    const untouched = (await tx.$queryRawUnsafe(`select "updatedAt" = "createdAt" u from public."AdminRole" where "key"='admin'`))[0].u;
    ok("The built-in Admin role manages courses (when it was never edited)", !untouched || builtIn.permissions.courses?.includes("content"), builtIn.permissions);
    const role = await v("exam_role_save", { nameAr: "منسق دورات اختبار", permissions: { courses: ["create", "update", "content"] } });
    ok("Course actions bring 'read' with them", role.permissions.courses.includes("read"), role.permissions);
    const readRole = await v("exam_role_save", { nameAr: "قارئ دورات اختبار", permissions: { courses: ["read"] } });
    const emptyRole = await v("exam_role_save", { nameAr: "بلا دورات اختبار", permissions: { settings: ["update"] } });
    await v("exam_admin_set_role", users.staff.email, "STAFF", role.id);
    await v("exam_admin_set_role", users.reader.email, "STAFF", readRole.id);
    await v("exam_admin_set_role", users.empty.email, "STAFF", emptyRole.id);

    // ── course data ──
    await as(users.stud);
    ok("A trainee cannot list or create courses", denied(await j("exam_course_list")) && denied(await j("exam_course_save", null, { titleAr: "x", titleEn: "x" })));
    await as(users.empty);
    ok("An admin without course permissions is refused", denied(await j("exam_course_list")));
    await as(users.reader);
    const list0 = await v("exam_course_list");
    ok("'read' lists every course", list0.length === before.p, list0.length);
    ok("'read' alone cannot create or edit", denied(await j("exam_course_save", null, { titleAr: "x", titleEn: "x" })) && denied(await j("exam_course_save", list0[0].programId, { titleAr: "y" })));

    await as(users.staff);
    let r = await j("exam_course_save", null, { titleAr: "دورة", titleEn: " " });
    ok("A course needs both titles", /title_missing/.test(r.error ?? ""), r.error);
    r = await j("exam_course_save", null, { titleAr: "دورة", titleEn: "Course", published: true });
    ok("Publishing needs a summary in both languages", /summary_missing/.test(r.error ?? ""), r.error);
    r = await j("exam_course_save", null, { titleAr: "دورة", titleEn: "Course", image: "javascript:alert(1)" });
    ok("A cover must be an https or site address", /invalid_course: image/.test(r.error ?? ""), r.error);
    r = await j("exam_course_save", null, { titleAr: "دورة", titleEn: "Course", hours: "ten" });
    ok("Hours must be a number", /invalid_course: hours/.test(r.error ?? ""), r.error);
    const a = await v("exam_course_save", null, { titleAr: "دورة اختبار أ", titleEn: "Test Course A", code: "TSTA", hours: 20 });
    const b = await v("exam_course_save", null, { titleAr: "دورة اختبار ب", titleEn: "Test Course A" });
    const A = a.programId, B = b.programId;
    ok("New courses are created hidden with unique addresses", a.published === false && a.slug === "tsta" && b.slug === "test-course-a", { a, b });
    const dup = await v("exam_course_save", null, { titleAr: "دورة ج", titleEn: "Test Course A" });
    ok("A repeated title gets a numbered address", dup.slug === "test-course-a-2", dup);
    r = await j("exam_course_save", B, { slug: "tsta" });
    ok("An address already used is refused", /slug_used/.test(r.error ?? ""), r.error);
    const folders = (await tx.$queryRawUnsafe(`select count(*)::int c from public."ExamFolder" where "programId"=$1`, A))[0].c;
    ok("The exam platform folders appear on the new course automatically", folders === 5, folders);
    await v("exam_course_save", A, { summaryAr: "ملخص", summaryEn: "Summary", published: true });
    let rec = await v("exam_course_record", A);
    ok("Editing keeps the fields that were not sent", rec.course.published && rec.course.code === "TSTA" && rec.course.hours === 20 && rec.course.titleAr === "دورة اختبار أ", rec.course);
    await v("exam_course_save", A, { published: false });
    const logs = (await tx.$queryRawUnsafe(`select "action" from public."ExamAuditLog" where "entityId"=$1`, A)).map((x) => x.action);
    ok("Create, publish and hide are logged", ["course.create", "course.publish", "course.hide"].every((x) => logs.includes(x)), logs);

    // ── trainers ──
    await as(users.boss);
    await v("exam_admin_assign_instructor", A, users.inst.email, {});
    await v("exam_admin_assign_instructor", A, users.helper.email, { canManageContent: false });
    await v("exam_enrollment_set", [(await member(users.stud)).id, (await member(users.expired)).id], A, { status: "ACTIVE" });
    await v("exam_enrollment_set", [(await member(users.other)).id], B, { status: "ACTIVE" });
    await tx.$executeRawUnsafe(`update public."Enrollment" set "expiresAt" = (now() at time zone 'utc') - interval '1 day' where "programId"=$1 and "memberId"=$2`, A, (await member(users.expired)).id);
    rec = await v("exam_course_record", A);
    ok("The course record lists its trainers", rec.trainers.length === 2 && rec.trainers.find((t) => t.email === users.helper.email).canManageContent === false, rec.trainers);
    await as(users.inst);
    const me = await v("exam_me");
    ok("A trainer manages content by default", me.courses.find((c) => c.programId === A)?.permissions?.canManageContent === true);

    // ── folders and items ──
    const f1 = (await v("exam_content_folder_save", A, { section: "MATERIAL", nameAr: "الوحدة الأولى" })).id;
    const f2 = (await v("exam_content_folder_save", A, { section: "MATERIAL", nameAr: "مجلد مخفي", published: false })).id;
    const vf = (await v("exam_content_folder_save", A, { section: "VIDEO", nameAr: "الفصل الأول" })).id;
    r = await j("exam_content_folder_save", A, { section: "OTHER", nameAr: "x" });
    ok("Only the two sections exist", /section/.test(r.error ?? ""), r.error);

    const pdf = file(A);
    const i1 = (await v("exam_content_item_save", A, { section: "MATERIAL", titleAr: "ملف", folderId: f1, ...pdf })).id;
    const doc = file(A, "docx");
    const i2 = (await v("exam_content_item_save", A, { section: "MATERIAL", titleAr: "مستند", ...doc })).id;
    const hiddenFile = file(A);
    const i3 = (await v("exam_content_item_save", A, { section: "MATERIAL", titleAr: "مخفي", published: false, ...hiddenFile })).id;
    const inHidden = file(A);
    const i4 = (await v("exam_content_item_save", A, { section: "MATERIAL", titleAr: "داخل مخفي", folderId: f2, ...inHidden })).id;
    r = await j("exam_content_item_save", A, { section: "MATERIAL", titleAr: "x", ...file(B) });
    ok("A file path of another course is refused", /invalid_content: file/.test(r.error ?? ""), r.error);
    r = await j("exam_content_item_save", A, { section: "MATERIAL", titleAr: "x", ...pdf });
    ok("The same stored file cannot back two items", /invalid_content: file/.test(r.error ?? ""), r.error);
    r = await j("exam_content_item_save", A, { section: "MATERIAL", titleAr: "x", ...file(A), size: 60000000 });
    ok("Files over 50 MB are refused", /too_big/.test(r.error ?? ""), r.error);
    r = await j("exam_content_item_save", A, { section: "MATERIAL", titleAr: "x", allowDownload: false, ...file(A, "docx") });
    ok("'View only' is refused for types a browser cannot show", /view_only_type/.test(r.error ?? ""), r.error);
    r = await j("exam_content_item_save", A, { section: "MATERIAL", titleAr: "x", folderId: vf, ...file(A) });
    ok("A file cannot go into a video folder", /invalid_content: folder/.test(r.error ?? ""), r.error);
    r = await j("exam_content_item_save", A, { section: "VIDEO", titleAr: "x", ...file(A) });
    ok("An uploaded video must be MP4 or WebM", /video_type/.test(r.error ?? ""), r.error);

    const yt = (await v("exam_content_item_save", A, { section: "VIDEO", source: "YOUTUBE", titleAr: "يوتيوب", folderId: vf, url: "https://www.youtube.com/watch?t=3&v=dQw4w9WgXcQ" })).id;
    const yt2 = (await v("exam_content_item_save", A, { section: "VIDEO", source: "YOUTUBE", titleAr: "قصير", url: "https://youtu.be/abcdefghijk?si=1" })).id;
    const vim = (await v("exam_content_item_save", A, { section: "VIDEO", source: "VIMEO", titleAr: "فيميو", url: "https://vimeo.com/123456789" })).id;
    const link = (await v("exam_content_item_save", A, { section: "VIDEO", source: "LINK", titleAr: "رابط", url: "https://example.org/v" })).id;
    const mp4 = file(A, "mp4");
    const up = (await v("exam_content_item_save", A, { section: "VIDEO", titleAr: "مرفوع", ...mp4 })).id;
    const refs = await tx.$queryRawUnsafe(`select "videoRef" from public."CourseItem" where "id" = any($1::text[]) order by "videoRef"`, [yt, yt2, vim]);
    ok("Video ids are read from YouTube and Vimeo addresses", JSON.stringify(refs.map((x) => x.videoRef)) === JSON.stringify(["123456789", "abcdefghijk", "dQw4w9WgXcQ"]), refs);
    for (const [src, url] of [["YOUTUBE", "https://evil.example/watch?v=dQw4w9WgXcQ"], ["YOUTUBE", "https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ"], ["VIMEO", "https://vimeo.example/123456789"], ["LINK", "javascript:alert(1)"], ["LINK", "http://example.org/v"], ["LINK", "https://example.org/\"><script>"]]) {
      r = await j("exam_content_item_save", A, { section: "VIDEO", source: src, titleAr: "x", url });
      ok(`Refused ${src} address ${url.slice(0, 45)}`, !!r.error && /invalid_content/.test(r.error), r.error);
    }
    r = await j("exam_content_item_save", A, { section: "MATERIAL", source: "YOUTUBE", titleAr: "x", url: "https://youtu.be/abcdefghijk" });
    ok("Videos belong to the video section", /invalid_content: source/.test(r.error ?? ""), r.error);

    // sharing
    r = await j("exam_content_item_save", A, { id: i1, sharedWith: [B] });
    ok("A trainer cannot share into a course they do not manage", /invalid_content: share/.test(r.error ?? ""), r.error);
    await as(users.boss);
    await v("exam_content_item_save", A, { id: i2, sharedWith: [B, A] });
    const shared = (await tx.$queryRawUnsafe(`select "sharedWith" s, "titleAr" t, "filePath" p from public."CourseItem" where "id"=$1`, i2))[0];
    ok("Sharing keeps the title and file, and ignores the item's own course", JSON.stringify(shared.s) === JSON.stringify([B]) && shared.t === "مستند" && shared.p === doc.filePath, shared);
    await as(users.inst);
    await v("exam_content_item_save", A, { id: i2, descAr: "وصف" });
    ok("A trainer can edit an already shared item without removing the share", (await tx.$queryRawUnsafe(`select "sharedWith" s from public."CourseItem" where "id"=$1`, i2))[0].s.length === 1);

    // ── who sees what ──
    await as(users.stud);
    let c = await v("exam_content", A);
    const ids = c.items.map((x) => x.id);
    ok("A trainee sees published items only (not hidden ones or those in a hidden folder)", ids.includes(i1) && ids.includes(i2) && !ids.includes(i3) && !ids.includes(i4) && !c.canManage && !c.staff && c.folders.every((f) => f.id !== f2), ids.length);
    ok("Trainees get no management fields", c.items.every((x) => !("versions" in x) && !("sharedWith" in x)) && c.courses.length === 0);
    ok("A trainee cannot change content", denied(await j("exam_content_item_save", A, { id: i1, published: false })) && denied(await j("exam_content_item_delete", i1)) && denied(await j("exam_content_folder_save", A, { section: "MATERIAL", nameAr: "x" })) && denied(await run("exam_content_move", "ITEM", i1, true)));
    ok("A trainee cannot read the progress report", denied(await j("exam_content_report", A)));
    ok("The trainee may read published files only", (await can(pdf.filePath, "read")) && (await can(mp4.filePath, "read")) && !(await can(hiddenFile.filePath, "read")) && !(await can(inHidden.filePath, "read")));
    ok("A trainee can never upload or delete files", !(await can(pdf.filePath, "write")) && !(await can(pdf.filePath, "delete")));
    ok("A file nobody registered is not readable", !(await can(`${A}/${randomUUID()}.pdf`, "read")));

    await as(users.other);
    ok("A trainee of another course cannot open this course", denied(await j("exam_content", A)));
    ok("… nor its files, except what was shared with theirs", !(await can(pdf.filePath, "read")) && (await can(doc.filePath, "read")));
    c = await v("exam_content", B);
    ok("The shared item appears in the other course", c.shared.length === 1 && c.shared[0].id === i2 && c.shared[0].fromCode === "TSTA", c.shared);
    ok("They can open the shared item but not the rest", (await v("exam_content_open", i2)).recorded && denied(await j("exam_content_open", i1)));

    await as(users.expired);
    ok("An expired subscription closes the course content", denied(await j("exam_content", A)) && !(await can(pdf.filePath, "read")) && denied(await j("exam_content_open", i1)));
    await as(users.none);
    ok("Someone not enrolled sees nothing", denied(await j("exam_content", A)) && !(await can(pdf.filePath, "read")));
    await as(null);
    ok("A signed-out visitor sees nothing", denied(await j("exam_content", A)) && !(await can(pdf.filePath, "read")) && denied(await j("exam_course_list")));
    const grants = (await tx.$queryRawUnsafe(`select count(*)::int c from unnest(array['CourseFolder','CourseItem','CourseItemVersion','ContentProgress']) t, unnest(array['anon','authenticated']) g
      where has_table_privilege(g, format('public.%I', t), 'select,insert,update,delete')`))[0].c;
    const open = await tx.$queryRawUnsafe(`select p.proname n from pg_proc p where p.pronamespace = 'public'::regnamespace and (p.proname like 'exam\\_c%' or p.proname like 'lms\\_%') and has_function_privilege('anon', p.oid, 'execute')`);
    const helpers = await tx.$queryRawUnsafe(`select p.proname n from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'lms\\_%' and has_function_privilege('authenticated', p.oid, 'execute')`);
    ok("Browser roles have no table access and no helper functions", grants === 0 && open.length === 0 && helpers.length === 0, { grants, open, helpers });

    // trainer without content permission, and course readers
    await as(users.helper);
    c = await v("exam_content", A);
    ok("A trainer without the permission sees everything but manages nothing", c.staff && !c.canManage && c.items.length >= 9 && denied(await j("exam_content_item_save", A, { id: i1, published: false })) && !(await can(`${A}/x.pdf`, "write")));
    await as(users.reader);
    c = await v("exam_content", A);
    ok("An admin with 'read' views but does not manage", c.staff && !c.canManage && denied(await j("exam_content_item_delete", i1)));
    await as(users.staff);
    c = await v("exam_content", B);
    ok("An admin with 'content' manages every course", c.canManage && (await can(`${B}/x.pdf`, "write")));
    await as(users.inst);
    ok("A trainer has no rights on another course", denied(await j("exam_content", B)) && !(await can(`${B}/x.pdf`, "write")));

    // ── progress ──
    await as(users.stud);
    c = await v("exam_content", A);
    const total = c.progress.total;
    ok("Progress counts published items", total === 7 && c.progress.done === 0, c.progress);
    await v("exam_content_open", i1);
    await v("exam_content_open", i1);
    await v("exam_content_open", yt);
    c = await v("exam_content", A);
    const it = (id) => c.items.find((x) => x.id === id);
    ok("Opening a file completes it; opening a video does not", c.progress.done === 1 && it(i1).progress.completed && !it(yt).progress.completed, c.progress);
    ok("Opens are counted", (await tx.$queryRawUnsafe(`select "opens" o from public."ContentProgress" where "itemId"=$1 and "memberId"=$2`, i1, (await member(users.stud)).id))[0].o === 2);
    let w = await v("exam_content_watch", yt, [[0, 30]], 100, 30);
    ok("30 of 100 seconds = 30%", w.percent === 30 && !w.completed, w);
    w = await v("exam_content_watch", yt, [[0, 30], [20, 50]], 100, 50);
    ok("Replayed parts are counted once", w.percent === 50, w);
    w = await v("exam_content_watch", yt, [[90, 5000]], 1, 90);
    ok("A shorter length reported later is ignored and parts are clipped", w.percent === 60 && !w.completed, w);
    w = await v("exam_content_watch", yt, [[50, 82]], 100, 82);
    ok("90% completes the video", w.percent === 92 && w.completed, w);
    c = await v("exam_content", A);
    ok("The player can resume and knows what was watched", it(yt).progress.positionSec === 82 && it(yt).progress.ranges.length === 2, it(yt).progress);
    for (const bad of [{ a: 1 }, [["a", 2]], [[1]], [1, 2], [[1, 2, 3]]]) {
      r = await j("exam_content_watch", yt2, bad, 100, 0);
      ok(`Bad watch data refused ${JSON.stringify(bad)}`, /invalid_content: ranges/.test(r.error ?? ""), r.error);
    }
    r = await j("exam_content_watch", vim, [[0, 10]], 100, 0);
    ok("Only measurable videos record watched time", /invalid_content: source/.test(r.error ?? ""), r.error);
    await v("exam_content_mark", vim, true);
    await v("exam_content_mark", link, true);
    await v("exam_content_mark", link, false);
    r = await j("exam_content_mark", yt2, true);
    ok("Measured videos cannot be ticked by hand", /invalid_content: source/.test(r.error ?? ""), r.error);
    c = await v("exam_content", A);
    ok("Marking and unmarking work", it(vim).progress.completed && !it(link).progress.completed && c.progress.done === 3, c.progress);

    await as(users.boss);
    await v("exam_content_open", i1);
    ok("A manager's preview is not recorded as study", (await tx.$queryRawUnsafe(`select count(*)::int c from public."ContentProgress" where "memberId"=$1`, (await member(users.boss)).id))[0].c === 0);
    await as(users.inst);
    let rep = await v("exam_content_report", A);
    const row = rep.trainees.find((t) => t.email === users.stud.email);
    const rowItem = rep.items.find((x) => x.id === yt);
    ok("The report shows each trainee and each item", row.progress.done === 3 && row.progress.total === 7 && row.videoSeconds === 92 && rowItem.completedBy === 1 && rowItem.openedBy === 1, { row, rowItem });
    await as(users.boss);
    const mr = await v("exam_member_record", (await member(users.stud)).id);
    ok("The trainee's file shows course content progress", mr.enrollments.find((e) => e.programId === A).content.done === 3, mr.enrollments);

    // ── replace, reorder, delete ──
    await as(users.inst);
    const next = file(A);
    const rv = await v("exam_content_replace", i1, next);
    ok("Replacing a file raises the version", rv.version === 2, rv);
    r = await j("exam_content_replace", i1, pdf);
    ok("An old version's file cannot be reused", /invalid_content: file/.test(r.error ?? ""), r.error);
    c = await v("exam_content", A);
    ok("Staff see the earlier version", c.items.find((x) => x.id === i1).versions.length === 1);
    await as(users.stud);
    ok("Trainees read the new version only", (await can(next.filePath, "read")) && !(await can(pdf.filePath, "read")));
    await as(users.inst);
    await v("exam_content_replace", up, file(A, "mp4"));
    r = await j("exam_content_item_save", A, { id: yt, url: "https://youtu.be/zzzzzzzzzzz" });
    ok("Changing a video's address resets what was watched", !r.error && (await tx.$queryRawUnsafe(`select count(*)::int c from public."ContentProgress" where "itemId"=$1`, yt))[0].c === 0, r.error);

    const order = async () => (await v("exam_content", A)).items.filter((x) => x.section === "VIDEO" && !x.folderId).map((x) => x.id);
    const o0 = await order();
    await run("exam_content_move", "ITEM", o0[1], true);
    const o1 = await order();
    await run("exam_content_move", "ITEM", o1[0], true);
    ok("Items move up and down inside their folder", o1[0] === o0[1] && o1[1] === o0[0] && JSON.stringify(await order()) === JSON.stringify(o1), { o0, o1 });
    await run("exam_content_move", "FOLDER", f2, true);
    const fo = (await v("exam_content", A)).folders.filter((f) => f.section === "MATERIAL").map((f) => f.id);
    ok("Folders can be reordered", fo[0] === f2 && fo[1] === f1, fo);

    await v("exam_content_folder_delete", f2);
    await as(users.stud);
    c = await v("exam_content", A);
    ok("Deleting a hidden folder keeps its items hidden", !c.items.some((x) => x.id === i4));
    await as(users.inst);
    const del = await v("exam_content_item_delete", i1);
    ok("Deleting returns every stored file of the item", del.paths.length === 2 && del.paths.includes(pdf.filePath) && del.paths.includes(next.filePath), del);
    ok("The item, its versions and progress are gone", (await tx.$queryRawUnsafe(`select (select count(*) from public."CourseItemVersion" where "itemId"=$1)::int + (select count(*) from public."ContentProgress" where "itemId"=$1)::int + (select count(*) from public."CourseItem" where "id"=$1)::int c`, i1))[0].c === 0);
    ok("A manager can remove the files from storage afterwards", await can(del.paths[0], "delete"));

    // cover bucket
    await as(users.staff);
    ok("Course editors may manage cover images of real courses only", (await v("exam_course_cover_can", `${A}/x.png`)) && !(await v("exam_course_cover_can", `nothing/x.png`)));
    await as(users.inst);
    ok("A trainer cannot manage cover images", !(await v("exam_course_cover_can", `${A}/x.png`)));

    throw ROLLBACK;
  }, { timeout: 240000, maxWait: 20000 });
} catch (e) {
  if (e !== ROLLBACK) ok("test run", false, e.message);
}

const [after] = await db.$queryRawUnsafe(countSql);
ok("Nothing was left in the database", JSON.stringify(before) === JSON.stringify(after), { before, after });
await db.$disconnect();

for (const r of results) console.log(`${r.pass ? "✔" : "✘"} ${r.name}${r.pass ? "" : `  → ${JSON.stringify(r.info).slice(0, 400)}`}`);
const passed = results.filter((r) => r.pass).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
