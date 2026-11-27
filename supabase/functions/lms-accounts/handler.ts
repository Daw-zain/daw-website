/**
 * Accounts of the platform (LMS-2): create, password link, delete.
 *
 * This is the only code that uses Supabase's administrator key. The order is always the same:
 *   1. ask the database, with the CALLER's own session, whether this is allowed (exam_account_check)
 *   2. only then use the administrator key
 *   3. write the result through functions that only the server role may execute (lms_account_*)
 *
 * No password is ever chosen, seen or returned: a person sets their own through a one-time link.
 * This file has no imports, so it runs in the Edge Function (Deno) and in the tests (Node).
 */

export type Rpc = (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: string | null }>;

export type Deps = {
  /** database calls made as the signed-in caller */
  caller: Rpc;
  /** database calls made with the server role */
  server: Rpc;
  auth: {
    /** a new sign-in without a password; exists = the e-mail already has one */
    createUser(email: string, name: string): Promise<{ id?: string; exists?: boolean; error?: string }>;
    /** a one-time link to set the password; notFound = no sign-in for this e-mail */
    recoveryLink(email: string, redirectTo: string): Promise<{ link?: string; userId?: string; notFound?: boolean; error?: string }>;
    deleteUser(id: string): Promise<{ error?: string }>;
  };
};

export type Result = { status: number; body: Record<string, unknown> };

/** where a password link may lead back to */
const REDIRECTS = ["https://daw-zain.github.io/daw-website/", "http://localhost:3000/", "http://localhost:3123/"];
const DEFAULT_REDIRECT = "https://daw-zain.github.io/daw-website/ar/account/reset/";
export const safeRedirect = (v: unknown) => (typeof v === "string" && v.length < 300 && REDIRECTS.some((p) => v.startsWith(p)) ? v : DEFAULT_REDIRECT);

/** at most this many accounts per request */
export const MAX_MANY = 25;

const KNOWN = ["already_member", "super_admin_only", "member_not_found", "cannot_disable_self", "rate_limited", "forbidden"];
function codeOf(message: string): string {
  const detail = message.match(/invalid_account: ([a-z_0-9]+)/)?.[1];
  return KNOWN.find((c) => message.includes(c)) ?? detail ?? "failed";
}
class Fail extends Error {
  constructor(public code: string, public status = 400) {
    super(code);
  }
}
const dbFail = (message: string) => {
  const code = codeOf(message);
  return new Fail(code, code === "forbidden" || code === "super_admin_only" ? 403 : code === "rate_limited" ? 429 : 400);
};

async function must(rpc: Rpc, fn: string, args: Record<string, unknown>) {
  const r = await rpc(fn, args);
  if (r.error) throw dbFail(r.error);
  return r.data;
}

/**
 * A sign-in that belongs to nobody yet. An older sign-in for the same e-mail (someone registered the address
 * but never used the platform) is removed first, so whoever chose its password cannot reach the new account.
 */
async function freshUser(deps: Deps, email: string, name: string, redirectTo: string): Promise<{ id: string; replaced: boolean }> {
  const first = await deps.auth.createUser(email, name);
  if (first.id) return { id: first.id, replaced: false };
  if (!first.exists) throw new Fail("auth_failed", 502);
  const old = await deps.auth.recoveryLink(email, redirectTo);
  if (!old.userId) throw new Fail("auth_failed", 502);
  if ((await deps.auth.deleteUser(old.userId)).error) throw new Fail("auth_failed", 502);
  const second = await deps.auth.createUser(email, name);
  if (!second.id) throw new Fail("auth_failed", 502);
  return { id: second.id, replaced: true };
}

type NewAccount = { email?: unknown; name?: unknown; role?: unknown; phone?: unknown; organization?: unknown; jobTitle?: unknown; city?: unknown };

async function createOne(deps: Deps, input: NewAccount, redirectTo: string) {
  const role = input.role === "INSTRUCTOR" ? "INSTRUCTOR" : input.role === undefined || input.role === "LEARNER" ? "LEARNER" : String(input.role);
  const name = String(input.name ?? "").trim();
  if (!name || name.length > 120) throw new Fail("name");
  const check = (await must(deps.caller, "exam_account_check", { p_action: "create", p_data: { email: String(input.email ?? ""), role } })) as { actor: string; email: string; role: string };
  const user = await freshUser(deps, check.email, name, redirectTo);
  const saved = await deps.server("lms_account_provision", {
    p_actor: check.actor,
    p_auth_id: user.id,
    p_email: check.email,
    p_role: check.role,
    p_data: { name, phone: input.phone ?? "", organization: input.organization ?? "", jobTitle: input.jobTitle ?? "", city: input.city ?? "" },
  });
  if (saved.error) {
    await deps.auth.deleteUser(user.id); // leave nothing half-made
    throw dbFail(saved.error);
  }
  return { memberId: saved.data as string, email: check.email, replaced: user.replaced };
}

async function dispatch(body: Record<string, unknown>, deps: Deps): Promise<Record<string, unknown>> {
  const redirectTo = safeRedirect(body.redirectTo);
  switch (body.action) {
    case "create": {
      const made = await createOne(deps, (body.account ?? {}) as NewAccount, redirectTo);
      if (body.link === false) return made;
      const l = await deps.auth.recoveryLink(made.email, redirectTo);
      return { ...made, link: l.link ?? null };
    }
    case "createMany": {
      const items = Array.isArray(body.accounts) ? (body.accounts as NewAccount[]) : [];
      if (!items.length || items.length > MAX_MANY) throw new Fail("max_25");
      const results: Record<string, unknown>[] = [];
      for (const item of items) {
        try {
          results.push(await createOne(deps, item, redirectTo));
        } catch (e) {
          const code = e instanceof Fail ? e.code : "failed";
          if (code === "forbidden" || code === "rate_limited") throw e;
          results.push({ email: String(item?.email ?? ""), error: code });
        }
      }
      return { results };
    }
    case "link": {
      const check = (await must(deps.caller, "exam_account_check", { p_action: "link", p_data: { memberId: body.memberId } })) as { actor: string; memberId: string; email: string; authUserId: string };
      let l = await deps.auth.recoveryLink(check.email, redirectTo);
      if (l.link && l.userId === check.authUserId) return { link: l.link, email: check.email, renewed: false };
      if (!l.userId && !l.notFound) throw new Fail("auth_failed", 502);
      // the member's own sign-in is gone (or the address now belongs to another one): make a new one and link it
      if (l.userId && (await deps.auth.deleteUser(l.userId)).error) throw new Fail("auth_failed", 502);
      const user = await freshUser(deps, check.email, "", redirectTo);
      await must(deps.server, "lms_account_relink", { p_actor: check.actor, p_member: check.memberId, p_auth_id: user.id });
      l = await deps.auth.recoveryLink(check.email, redirectTo);
      if (!l.link) throw new Fail("auth_failed", 502);
      return { link: l.link, email: check.email, renewed: true };
    }
    case "delete": {
      const check = (await must(deps.caller, "exam_account_check", { p_action: "delete", p_data: { memberId: body.memberId, confirm: body.confirm } })) as { actor: string; memberId: string; authUserId: string };
      const erased = (await must(deps.server, "lms_account_erase", { p_actor: check.actor, p_member: check.memberId })) as { paths: string[] };
      const gone = await deps.auth.deleteUser(check.authUserId);
      // the record is already anonymous and switched off even if removing the sign-in failed
      return { deleted: true, signInRemoved: !gone.error, paths: erased.paths };
    }
    default:
      throw new Fail("action");
  }
}

export async function handle(body: unknown, deps: Deps): Promise<Result> {
  try {
    if (!body || typeof body !== "object") throw new Fail("action");
    return { status: 200, body: await dispatch(body as Record<string, unknown>, deps) };
  } catch (e) {
    if (e instanceof Fail) return { status: e.status, body: { error: e.code } };
    console.error("[lms-accounts]", e instanceof Error ? e.message : e);
    return { status: 500, body: { error: "failed" } };
  }
}
