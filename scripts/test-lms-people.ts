// LMS-2: trainees, trainers, subscriptions and accounts.
// run: npx tsx --env-file=.env scripts/test-lms-people.ts — one transaction, rolled back at the end.
// The account function's real code (supabase/functions/lms-accounts/handler.ts) runs against the real database;
// only Supabase's sign-in service is replaced by an in-memory stand-in, so no real account is created.
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { handle, safeRedirect, type Deps } from "../supabase/functions/lms-accounts/handler";

const db = new PrismaClient();
const ROLLBACK = new Error("rollback");
const results: { name: string; pass: boolean; info: string }[] = [];
const ok = (name: string, pass: unknown, info: unknown = "") => results.push({ name, pass: !!pass, info: typeof info === "string" ? info : JSON.stringify(info) });
type User = { sub: string; email: string };
const u = (n: string): User => ({ sub: randomUUID(), email: `t-${n}@lms2.test` });
const users = { boss: u("boss"), staff: u("staff"), clerk: u("clerk"), reader: u("reader"), trainer: u("trainer"), learner: u("learner"), other: u("other") };
type R = { value?: any; error?: string };

const countSql = `select (select count(*)::int from public."ExamMember") m, (select count(*)::int from public."Enrollment") e, (select count(*)::int from public."MemberProfile") p,
  (select count(*)::int from public."ExamAttempt") a, (select count(*)::int from public."ExamAuditLog") l, (select string_agg("email" || ':' || "role", ',' order by "email") from public."ExamMember") roles`;

async function main() {
  const [before] = (await db.$queryRawUnsafe(countSql)) as object[];
  try {
    await db.$transaction(
      async (tx) => {
        const as = (x: User | null) => tx.$executeRawUnsafe(`select set_config('request.jwt.claims', $1, true)`, x ? JSON.stringify({ sub: x.sub, email: x.email, role: "authenticated" }) : "");
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
        const cast = (v: unknown) => (v === null ? "::text" : typeof v === "object" ? "::jsonb" : typeof v === "boolean" ? "::boolean" : "");
        const j = (fn: string, ...a: unknown[]) => call(`select public.${fn}(${a.map((v, i) => `$${i + 1}${cast(v)}`).join(",")})`, ...a.map((x) => (x !== null && typeof x === "object" ? JSON.stringify(x) : x)));
        const v = async (fn: string, ...a: unknown[]) => {
          const r = await j(fn, ...a);
          if (r.error) throw new Error(`${fn}: ${r.error}`);
          return r.value;
        };
        const q = async <T = any>(sql: string, ...a: unknown[]) => (await tx.$queryRawUnsafe(sql, ...a)) as T[];
        const member = async (email: string) => (await q(`select * from public."ExamMember" where "email"=$1`, email))[0];
        const resetRate = () => tx.$executeRawUnsafe(`delete from public."ExamRateLimit"`);
        const denied = (r: R) => /forbidden|super_admin_only/.test(r.error ?? "");

        // ── stand-in for Supabase sign-in ──
        const signins = new Map<string, string>(); // email → id
        const removed: string[] = [];
        let failServer = "";
        const depsFor = (who: User): Deps => {
          const rpc = async (fn: string, args: Record<string, unknown>) => {
            const keys = Object.keys(args);
            const r = await call(
              `select public.${fn}(${keys.map((k, i) => `${k} => $${i + 1}${cast(args[k])}`).join(",")})${fn === "lms_account_relink" ? "::text" : ""}`,
              ...keys.map((k) => (args[k] !== null && typeof args[k] === "object" ? JSON.stringify(args[k]) : args[k])),
            );
            return { data: r.value, error: r.error ?? null };
          };
          return {
            caller: async (fn, args) => {
              await as(who);
              return rpc(fn, args);
            },
            server: async (fn, args) => {
              await as(null);
              return failServer === fn ? { data: null, error: "boom" } : rpc(fn, args);
            },
            auth: {
              async createUser(email) {
                if (signins.has(email)) return { exists: true };
                const id = randomUUID();
                signins.set(email, id);
                return { id };
              },
              async recoveryLink(email, redirectTo) {
                const id = signins.get(email);
                return id ? { link: `https://auth.test/verify?u=${id}&to=${encodeURIComponent(redirectTo)}`, userId: id } : { notFound: true };
              },
              async deleteUser(id) {
                for (const [e, i] of signins) if (i === id) signins.delete(e);
                removed.push(id);
                return {};
              },
            },
          };
        };
        const account = async (who: User, body: object) => handle(body, depsFor(who)) as Promise<{ status: number; body: any }>;

        const courses = await q<{ id: string; code: string }>(`select "id", "code" from public."Program" p where not exists (select 1 from public."Question" x where x."programId"=p."id") order by p."order" limit 2`);
        const [c1, c2] = courses.map((c) => c.id);
        for (const x of Object.values(users)) {
          await as(x);
          await v("exam_me");
          signins.set(x.email, x.sub);
        }
        await tx.$executeRawUnsafe(`update public."ExamMember" set "role"='LEARNER' where "role"='ADMIN'`);
        await tx.$executeRawUnsafe(`update public."ExamMember" set "role"='ADMIN' where "email"=$1`, users.boss.email);
        await as(users.boss);
        const adminRole = (await v("exam_roles")).roles.find((r: any) => r.key === "admin");
        ok("The built-in Admin role may create accounts, but not export or delete them", adminRole.permissions.users.includes("create") && !adminRole.permissions.users.includes("export"), adminRole.permissions);
        const clerkRole = await v("exam_role_save", { nameAr: "موظف تسجيل", permissions: { users: ["create", "update"] } });
        const readRole = await v("exam_role_save", { nameAr: "قارئ", permissions: { users: ["read"] } });
        await v("exam_admin_set_role", users.staff.email, "STAFF", adminRole.id);
        await v("exam_admin_set_role", users.clerk.email, "STAFF", clerkRole.id);
        await v("exam_admin_set_role", users.reader.email, "STAFF", readRole.id);
        await v("exam_admin_assign_instructor", c1, users.trainer.email, { canPublishExams: true });
        const ids = Object.fromEntries(await Promise.all(Object.entries(users).map(async ([k, x]) => [k, (await member(x.email)).id]))) as Record<keyof typeof users, string>;

        // ── create ──
        let r = await account(users.staff, { action: "create", account: { email: " New.One@lms2.test ", name: "متدرب جديد", phone: "+218 91 000", organization: "جهة" }, redirectTo: "https://daw-zain.github.io/daw-website/en/account/reset/" });
        const newOne = await member("new.one@lms2.test");
        ok("Admin creates a trainee: member, profile, one-time link, no password", r.status === 200 && newOne?.role === "LEARNER" && newOne.authUserId === signins.get("new.one@lms2.test") && r.body.link?.includes(newOne.authUserId) && !JSON.stringify(r.body).includes("password"), r);
        ok("…the link returns to this site", decodeURIComponent(r.body.link).includes("/en/account/reset/"), r.body.link);
        const [prof] = await q(`select * from public."MemberProfile" where "memberId"=$1`, newOne.id);
        const [log] = await q(`select * from public."ExamAuditLog" where "action"='member.create' and "entityId"=$1`, newOne.id);
        ok("…profile saved and the creation logged with who did it", prof?.phone === "+218 91 000" && prof.organization === "جهة" && log?.actorId === ids.staff, { prof, log });
        r = await account(users.staff, { action: "create", account: { email: "new.one@lms2.test", name: "x" } });
        ok("The same e-mail twice is refused and the sign-in is untouched", r.status === 400 && r.body.error === "already_member" && signins.get("new.one@lms2.test") === newOne.authUserId, r);
        const size = signins.size;
        for (const [label, acc, code] of [
          ["a bad e-mail", { email: "nope", name: "x" }, "email"],
          ["a missing name", { email: "a@lms2.test", name: "  " }, "name"],
          ["creating a super admin", { email: "a@lms2.test", name: "x", role: "ADMIN" }, "role"],
          ["creating an admin", { email: "a@lms2.test", name: "x", role: "STAFF" }, "role"],
        ] as const) {
          r = await account(users.staff, { action: "create", account: acc });
          ok(`Refused: ${label}`, r.body.error === code && signins.size === size, r);
        }
        for (const [label, who] of [["A trainee", users.learner], ["A trainer", users.trainer], ["A read-only admin", users.reader]] as const) {
          r = await account(who, { action: "create", account: { email: "b@lms2.test", name: "x" } });
          ok(`${label} cannot create accounts`, r.status === 403 && signins.size === size && !(await member("b@lms2.test")), r);
        }
        r = await account(users.clerk, { action: "create", account: { email: "t2@lms2.test", name: "مدرب", role: "INSTRUCTOR" } });
        ok("Creating a trainer also needs the trainers permission", r.status === 403 && !signins.has("t2@lms2.test"), r);
        r = await account(users.staff, { action: "create", account: { email: "t2@lms2.test", name: "مدرب ثان", role: "INSTRUCTOR" }, link: false });
        ok("…with it, a trainer is created (without a link when not asked)", r.status === 200 && (await member("t2@lms2.test"))?.role === "INSTRUCTOR" && !("link" in r.body), r);

        signins.set("squat@lms2.test", "old-signin");
        r = await account(users.staff, { action: "create", account: { email: "squat@lms2.test", name: "صاحب البريد" } });
        ok("An unused older sign-in for the address is replaced, so its password is useless", r.body.replaced === true && removed.includes("old-signin") && (await member("squat@lms2.test")).authUserId !== "old-signin", r);
        failServer = "lms_account_provision";
        r = await account(users.staff, { action: "create", account: { email: "half@lms2.test", name: "x" } });
        failServer = "";
        ok("If saving fails, the new sign-in is removed again", r.status === 400 && !signins.has("half@lms2.test") && !(await member("half@lms2.test")), r);

        r = await account(users.staff, { action: "createMany", accounts: [{ email: "m1@lms2.test", name: "أ" }, { email: "bad", name: "ب" }, { email: "m1@lms2.test", name: "ج" }, { email: "m2@lms2.test", name: "د" }] });
        ok("Many at once: each row has its own outcome", r.status === 200 && r.body.results.map((x: any) => x.error ?? "ok").join() === "ok,email,already_member,ok", r.body);
        r = await account(users.staff, { action: "createMany", accounts: Array.from({ length: 26 }, (_, i) => ({ email: `z${i}@lms2.test`, name: "z" })) });
        ok("More than 25 per request refused", r.body.error === "max_25" && !signins.has("z0@lms2.test"), r);
        r = await account(users.learner, { action: "createMany", accounts: [{ email: "z@lms2.test", name: "z" }] });
        ok("Without permission the whole list is refused", r.status === 403, r);
        ok("Links only lead back to this site", safeRedirect("https://evil.test/") === safeRedirect(undefined) && safeRedirect("https://daw-zain.github.io/daw-website.evil/x") === safeRedirect(undefined), safeRedirect("https://evil.test/"));

        // ── password links ──
        await resetRate();
        r = await account(users.staff, { action: "link", memberId: newOne.id });
        ok("Admin gets a password link for a trainee (logged)", r.status === 200 && r.body.link.includes(newOne.authUserId) && r.body.renewed === false && (await q(`select 1 from public."ExamAuditLog" where "action"='member.password_link' and "entityId"=$1`, newOne.id)).length === 1, r);
        for (const [label, target] of [["the super admin", ids.boss], ["another admin", ids.clerk], ["themselves", ids.staff]] as const) {
          r = await account(users.staff, { action: "link", memberId: target });
          ok(`Takeover blocked: no link for ${label}`, r.status === 403 && !("link" in r.body), r);
        }
        r = await account(users.boss, { action: "link", memberId: ids.staff });
        ok("The super admin may send a link to an admin", r.status === 200 && !!r.body.link, r);
        r = await account(users.staff, { action: "link", memberId: ids.trainer });
        ok("Link for a trainer whose course permissions the admin holds", r.status === 200, r);
        await as(users.boss);
        await v("exam_admin_assign_instructor", c1, users.trainer.email, { canExport: true });
        r = await account(users.staff, { action: "link", memberId: ids.trainer });
        ok("…refused once the trainer holds a permission the admin lacks", r.status === 403, r);
        await as(users.boss);
        await v("exam_admin_set_role", users.trainer.email, "LEARNER");
        r = await account(users.staff, { action: "link", memberId: ids.trainer });
        ok("…also while that trainer is parked as a trainee", r.status === 403, r);
        await as(users.boss);
        await v("exam_admin_set_role", users.trainer.email, "INSTRUCTOR");
        r = await account(users.learner, { action: "link", memberId: newOne.id });
        ok("A trainee cannot get links", r.status === 403, r);

        // a different sign-in with a member's e-mail takes over nothing
        await as({ sub: randomUUID(), email: users.boss.email });
        let x = await j("exam_me");
        ok("Registering an existing member's address gives no access (account_conflict)", /account_conflict/.test(x.error ?? "") && (await member(users.boss.email)).authUserId === users.boss.sub, x);

        signins.delete("m1@lms2.test");
        const m1 = await member("m1@lms2.test");
        r = await account(users.staff, { action: "link", memberId: m1.id });
        ok("A lost sign-in is created again and linked to the same member", r.body.renewed === true && (await member("m1@lms2.test")).authUserId === signins.get("m1@lms2.test") && signins.get("m1@lms2.test") !== m1.authUserId, r);
        signins.set("m2@lms2.test", "intruder");
        const m2 = await member("m2@lms2.test");
        r = await account(users.staff, { action: "link", memberId: m2.id });
        ok("A sign-in that does not belong to the member is removed, not linked", r.body.renewed === true && removed.includes("intruder") && !["intruder", m2.authUserId].includes((await member("m2@lms2.test")).authUserId), r);

        // ── profiles ──
        await resetRate();
        await as(users.staff);
        x = await j("exam_profile_save", newOne.id, { name: "اسم معدل", city: "طرابلس", experienceYears: "5", adminNotes: "ملاحظة سرية" });
        ok("Edits a trainee's profile; fields not sent are kept", x.value?.city === "طرابلس" && x.value.phone === "+218 91 000" && x.value.experienceYears === 5 && (await member(newOne.email)).name === "اسم معدل", x);
        for (const [data, code] of [[{ phone: "abc" }, "phone"], [{ experienceYears: "200" }, "experience"], [{ bioAr: "س".repeat(3001) }, "too_long"], [{ name: " " }, "name"]] as const) {
          x = await j("exam_profile_save", newOne.id, data);
          ok(`Profile validation: ${code}`, new RegExp(`invalid_profile: ${code}`).test(x.error ?? ""), x);
        }
        x = await j("exam_profile_save", ids.boss, { city: "x" });
        ok("An admin cannot edit the super admin", denied(x), x);
        await as(users.clerk);
        x = await j("exam_profile_save", newOne.id, { city: "x" });
        ok("Without the trainees permission, no profile edits", denied(x), x);
        await as(users.learner);
        x = await j("exam_profile_save", ids.learner, { city: "x" });
        ok("A trainee cannot edit through the staff function (own profile comes with the trainee dashboard)", denied(x), x);

        await as(users.staff);
        const photo = `${newOne.id}/${randomUUID()}.png`;
        x = await j("exam_member_photo", newOne.id, photo);
        const x2 = await j("exam_member_photo", newOne.id, `${newOne.id}/${randomUUID()}.jpg`);
        ok("Sets a photo and reports the replaced file", !x.error && x.value.previous === null && x2.value.previous === photo, [x, x2]);
        x = await j("exam_member_photo", newOne.id, `${ids.boss}/a.png`);
        ok("A file path of another person is refused", /invalid_profile: file/.test(x.error ?? ""), x);
        const cert = `${ids.trainer}/${randomUUID()}.pdf`;
        x = await j("exam_qualification_save", ids.trainer, { kind: "CERTIFICATE", titleAr: "PMP", issuer: "PMI", year: "2022", filePath: cert, fileName: "pmp.pdf" });
        const qid = x.value?.id;
        ok("Adds a trainer's certificate with its file", !!qid && x.value.year === 2022 && x.value.filePath === cert, x);
        x = await j("exam_qualification_save", ids.trainer, { titleAr: "x", year: "1800" });
        ok("A wrong year is refused", /invalid_profile: year/.test(x.error ?? ""), x);
        x = await j("exam_qualification_save", newOne.id, { id: qid, titleAr: "سرقة" });
        ok("A qualification cannot be moved to someone else", /not_found/.test(x.error ?? ""), x);
        await as(users.learner);
        x = await j("exam_qualification_delete", qid);
        ok("A trainee cannot delete a certificate", denied(x), x);
        const file = async (who: User | null, path: string, action: string) => {
          await as(who);
          return (await v("exam_member_file_can", path, action)) as boolean;
        };
        ok("Files: the owner and account staff read them; other trainees and visitors do not", (await file(users.trainer, cert, "read")) && (await file(users.reader, cert, "read")) && !(await file(users.learner, cert, "read")) && !(await file(null, cert, "read")), "");
        ok("Files: only someone who may edit the person uploads", (await file(users.staff, cert, "write")) && !(await file(users.reader, cert, "write")) && !(await file(users.trainer, cert, "write")), "");
        await as(users.staff);
        x = await j("exam_qualification_delete", qid);
        ok("Deleting a certificate returns its file for removal", x.value?.previous === cert, x);

        // ── subscriptions ──
        const trainee = users.learner;
        await as(users.trainer);
        const tq = await v("exam_bank_question_save", c1, { type: "TRUE_FALSE", stemAr: "سؤال", status: "ACTIVE", answer: { value: true } });
        const dom = (await v("exam_course_folders", c1)).find((f: any) => f.kind === "DOMAIN_TESTS").id;
        const exam = await v("exam_exam_save", { folderId: dom, titleAr: "اختبار", durationMinutes: 10, maxAttempts: 5, items: [{ questionId: tq.id }] });
        await v("exam_exam_publish", exam.id);
        const set = async (data: object, who: User = users.staff, list: string[] = [ids.learner]) => {
          await as(who);
          return j("exam_enrollment_set", list, c1, data);
        };
        const opens = async () => {
          await as(trainee);
          const me = await v("exam_me");
          const info = await j("exam_take_info", exam.id);
          return { listed: me.courses.some((c: any) => c.programId === c1), info: !info.error };
        };
        const day = (n: number) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
        x = await set({ status: "ACTIVE", expiresAt: day(30) });
        let o = await opens();
        ok("A valid subscription opens the course", x.value?.done === 1 && o.listed && o.info, [x, o]);
        const [en] = await q(`select to_char("expiresAt",'YYYY-MM-DD HH24:MI') t from public."Enrollment" where "memberId"=$1 and "programId"=$2`, ids.learner, c1);
        ok("'Valid until' means the end of that day in Libya", en.t === `${day(30)} 22:00`, en);
        await as(trainee);
        const att = (await v("exam_attempt_start", exam.id)).attemptId;
        await v("exam_attempt_submit", att);
        await set({ expiresAt: day(-2) });
        o = await opens();
        await as(trainee);
        x = await j("exam_attempt_start", exam.id);
        ok("An expired subscription closes the course, its tests and new attempts", !o.listed && !o.info && denied(x), [o, x]);
        await set({ expiresAt: "", startsAt: day(10) });
        o = await opens();
        ok("A subscription that starts later is not open yet", !o.listed && !o.info, o);
        await set({ startsAt: "" });
        o = await opens();
        ok("Clearing the dates opens it again", o.listed && o.info, o);
        await set({ status: "SUSPENDED" });
        o = await opens();
        await set({ status: "CANCELLED" });
        const o2 = await opens();
        const [kept] = await q(`select count(*)::int n from public."ExamAttempt" where "memberId"=$1`, ids.learner);
        ok("Suspended and cancelled subscriptions are closed; results are kept", !o.listed && !o2.listed && kept.n === 1, [o, o2, kept]);
        x = await set({ status: "ACTIVE", startsAt: day(5), expiresAt: day(1) });
        ok("An end date before the start date is refused", /invalid_enrollment: dates/.test(x.error ?? ""), x);
        x = await set({ expiresAt: "31/12/2026" });
        ok("A malformed date is refused", /invalid_enrollment: date/.test(x.error ?? ""), x);
        x = await set({ status: "ACTIVE" }, users.staff, [ids.learner, ids.other, "nobody"]);
        ok("Several trainees at once; unknown ids are counted", x.value?.done === 2 && x.value.missing === 1, x);
        x = await set({ status: "ACTIVE" }, users.staff, Array.from({ length: 201 }, (_, i) => `x${i}`));
        ok("More than 200 at once refused", /max_200/.test(x.error ?? ""), x);
        x = await set({ status: "ACTIVE" }, users.clerk);
        ok("Without the trainees permission nobody is subscribed", denied(x), x);
        await as(users.boss);
        x = await j("exam_admin_enroll", c2, users.other.email, "CANCELLED");
        ok("The older enrol action knows the cancelled state", x.value?.status === "CANCELLED", x);

        // ── lists ──
        await resetRate();
        await as(users.staff);
        await v("exam_enrollment_set", [newOne.id], c1, { status: "ACTIVE", expiresAt: day(-1) });
        const people = async (f: object) => {
          const y = await j("exam_people", f);
          return y.value ?? y;
        };
        let p = await people({ kind: "trainee", q: "91 000" });
        ok("Search by phone", p.total === 1 && p.items[0].email === newOne.email && p.items[0].enrollments[0].open === false, p);
        p = await people({ kind: "trainee", q: "new.one" });
        ok("Search by e-mail", p.total === 1, p.total);
        p = await people({ kind: "trainee", programId: c1, enrollment: "EXPIRED" });
        ok("Filter: expired in a course", p.total === 1 && p.items[0].id === newOne.id, p);
        p = await people({ kind: "trainee", programId: c1, enrollment: "ACTIVE" });
        ok("Filter: open subscriptions in a course", p.total === 2 && p.items.every((i: any) => [ids.learner, ids.other].includes(i.id)), p);
        p = await people({ kind: "trainee", programId: c2, enrollment: "CANCELLED" });
        ok("Filter: cancelled", p.total === 1, p.total);
        const none = await people({ kind: "trainee", enrollment: "NONE", q: "@lms2.test" });
        ok("Filter: not subscribed anywhere", none.total >= 3 && none.items.every((i: any) => i.enrollments.length === 0), none.total);
        await as(users.boss);
        await v("exam_admin_set_active", "m1@lms2.test", false);
        await as(users.staff);
        p = await people({ kind: "trainee", status: "disabled", q: "@lms2.test" });
        ok("Filter: disabled accounts", p.total === 1 && p.items[0].email === "m1@lms2.test", p);
        p = await people({ kind: "trainee", from: day(2) });
        const p2 = await people({ kind: "trainee", from: day(-2), to: day(2), q: "@lms2.test" });
        ok("Filter by registration date", p.total === 0 && p2.total >= 5, [p.total, p2.total]);
        p = await people({ kind: "trainer", q: "@lms2.test" });
        const p3 = await people({ kind: "trainer", programId: c1 });
        ok("Trainers are listed with their courses", p.total === 2 && p3.items.some((i: any) => i.id === ids.trainer && i.courses.length === 1) && p3.total === 1, [p.total, p3]);
        x = await j("exam_people", { export: true });
        ok("Exporting the list needs its own permission", denied(x), x);
        await as(users.boss);
        x = await j("exam_people", { export: true, kind: "trainee" });
        ok("The super admin exports; the export is logged", x.value?.items.length === x.value?.total && (await q(`select 1 from public."ExamAuditLog" where "action"='member.export'`)).length === 1, x.error);
        for (const who of [users.learner, users.trainer]) {
          await as(who);
          x = await j("exam_people", {});
          const y = await j("exam_member_record", ids.boss);
          ok(`${who === users.learner ? "A trainee" : "A trainer"} sees no people lists or records`, denied(x) && denied(y), [x, y]);
        }

        // ── one person ──
        await resetRate();
        await as(users.staff);
        await v("exam_enrollment_set", [ids.learner], c1, { status: "ACTIVE" });
        let rec = await v("exam_member_record", ids.learner);
        const e1 = rec.enrollments.find((e: any) => e.programId === c1);
        ok("Record: progress in the course's tests and the attempts", e1?.progress?.tests === 1 && e1.progress.taken === 1 && e1.progress.attempts === 1 && Number(e1.progress.avgPercent) === 0 && e1.progress.mistakes === 0 && rec.attempts.length === 1 && rec.hiddenAttempts === 0, rec.enrollments);
        ok("Record: what the admin may do with this person", rec.can.edit && rec.can.enroll && rec.can.link && rec.can.status && !rec.can.delete, rec.can);
        ok("Record: activity (the admin role reads the log)", Array.isArray(rec.activity) && rec.activity.some((a: any) => a.action === "enrollment.set"), rec.activity?.length);
        await as(users.reader);
        rec = await v("exam_member_record", newOne.id);
        ok("A read-only admin sees no private notes, no results and no activity", !("adminNotes" in rec.profile) && rec.enrollments[0].progress === null && rec.activity === null && !rec.can.edit && !rec.can.link, rec);
        rec = await v("exam_member_record", ids.learner);
        ok("…and is told how many attempts are hidden", rec.attempts.length === 0 && rec.hiddenAttempts === 1, [rec.attempts.length, rec.hiddenAttempts]);

        // ── import check ──
        await resetRate();
        await as(users.staff);
        x = await j("exam_people_import_check", [
          { email: "fresh@lms2.test", name: "جديد", course: courses[0].code },
          { email: "fresh@lms2.test", name: "مكرر" },
          { email: "wrong", name: "x" },
          { email: "n@lms2.test", name: "" },
          { email: "c@lms2.test", name: "x", course: "NOPE" },
          { email: users.boss.email, name: "x", course: courses[0].code },
          { email: users.other.email, name: "x" },
          { email: users.other.email.toUpperCase().replace("T-OTHER", "t-learner"), name: "x", course: courses[0].code.toLowerCase() },
          { email: "p@lms2.test", name: "x", phone: "letters" },
        ]);
        ok("Import check gives each row its verdict", x.value?.map((i: any) => i.problem ?? "ok").join() === "ok,duplicate,email,name,course,not_trainee,already_member,ok,phone", x.value ?? x.error);
        ok("…an existing trainee is only to be subscribed", x.value?.[7].memberId === ids.learner && x.value[7].programId === c1 && x.value[0].memberId === null, x.value?.[7]);
        x = await j("exam_people_import_check", Array.from({ length: 501 }, () => ({ email: "a@b.co", name: "x" })));
        ok("At most 500 rows per file", /max_500/.test(x.error ?? ""), x);
        await as(users.reader);
        x = await j("exam_people_import_check", []);
        ok("The import check needs the create permission", denied(x), x);

        // ── delete ──
        await resetRate();
        r = await account(users.staff, { action: "delete", memberId: ids.learner, confirm: trainee.email });
        ok("Only the super admin deletes accounts", r.status === 403 && r.body.error === "super_admin_only" && !!(await member(trainee.email)), r);
        r = await account(users.boss, { action: "delete", memberId: ids.learner, confirm: "wrong@x.test" });
        ok("Deleting needs the e-mail typed correctly", r.body.error === "confirm" && !!(await member(trainee.email)), r);
        r = await account(users.boss, { action: "delete", memberId: ids.boss, confirm: users.boss.email });
        ok("Nobody deletes their own account", r.body.error === "cannot_disable_self", r);
        await as(users.boss);
        await v("exam_profile_save", ids.learner, { phone: "0910000000" });
        const lp = `${ids.learner}/${randomUUID()}.png`;
        await v("exam_member_photo", ids.learner, lp);
        r = await account(users.boss, { action: "delete", memberId: ids.learner, confirm: ` ${trainee.email.toUpperCase()} ` });
        const [gone] = await q(`select * from public."ExamMember" where "id"=$1`, ids.learner);
        const [left] = await q(`select (select count(*)::int from public."MemberProfile" where "memberId"=$1) p, (select count(*)::int from public."ExamAttempt" where "memberId"=$1) a, (select count(*)::int from public."Enrollment" where "memberId"=$1 and "status"<>'CANCELLED') e`, ids.learner);
        ok("Delete: personal data removed, sign-in removed, results kept anonymously", r.status === 200 && r.body.signInRemoved && r.body.paths.includes(lp) && gone.email.endsWith("@deleted.invalid") && !gone.active && !!gone.deletedAt && left.p === 0 && left.a === 1 && left.e === 0 && removed.includes(trainee.sub), [r, gone, left]);
        await as(trainee);
        x = await j("exam_me");
        ok("The old session is refused", /account_disabled/.test(x.error ?? ""), x);
        await as(users.boss);
        const after1 = [await j("exam_member_record", ids.learner), await j("exam_profile_save", ids.learner, { city: "x" }), await j("exam_admin_set_active", gone.email, true), await j("exam_admin_set_role", gone.email, "ADMIN")];
        const listed = await v("exam_admin_members", "");
        ok("A deleted account cannot be opened, edited, re-enabled or listed", after1.every((y) => !!y.error) && !listed.some((m: any) => m.id === ids.learner), after1.map((y) => y.error ?? "allowed"));
        ok("…and its files may still be removed", await file(users.boss, lp, "delete"), "");

        // ── what browsers may touch ──
        const [g] = await q(`select
          has_table_privilege('authenticated','public."MemberProfile"','select') t1, has_table_privilege('anon','public."MemberQualification"','select') t2,
          has_function_privilege('authenticated','public.lms_account_provision(text,text,text,text,jsonb)','execute') s1,
          has_function_privilege('authenticated','public.lms_account_erase(text,text)','execute') s2,
          has_function_privilege('authenticated','public.lms_account_relink(text,text,text)','execute') s3,
          has_function_privilege('anon','public.lms_account_provision(text,text,text,text,jsonb)','execute') s4,
          has_function_privilege('service_role','public.lms_account_provision(text,text,text,text,jsonb)','execute') s5,
          has_function_privilege('anon','public.exam_account_check(text,jsonb)','execute') a1,
          has_function_privilege('anon','public.exam_people(jsonb)','execute') a2,
          has_function_privilege('anon','public.exam_member_file_can(text,text)','execute') a3,
          has_function_privilege('authenticated','public.exam_may_send_link(public."ExamMember")','execute') h1`);
        ok("Account writes belong to the server role alone; visitors have nothing", !g.t1 && !g.t2 && !g.s1 && !g.s2 && !g.s3 && !g.s4 && g.s5 && !g.a1 && !g.a2 && !g.a3 && !g.h1, g);

        throw ROLLBACK;
      },
      { timeout: 300000, maxWait: 30000 },
    );
  } catch (e) {
    if (e !== ROLLBACK) results.push({ name: "test run", pass: false, info: (e as Error).message });
  }
  const [after] = (await db.$queryRawUnsafe(countSql)) as object[];
  ok("Rollback: the database is exactly as before", JSON.stringify(before) === JSON.stringify(after), { before, after });
  await db.$disconnect();

  for (const r of results) console.log(`${r.pass ? "✔" : "✘"} ${r.name}${r.pass ? "" : `  → ${r.info.slice(0, 600)}`}`);
  const passed = results.filter((r) => r.pass).length;
  console.log(`\n${passed}/${results.length} passed`);
  process.exit(passed === results.length ? 0 : 1);
}
main();
