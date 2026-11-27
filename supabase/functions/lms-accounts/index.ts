// Supabase Edge Function (Deno). All the rules are in handler.ts; this file only connects it to Supabase.
// The keys come from the function's environment (set by Supabase) and are never sent to the browser.
// Deployed with verify_jwt = false: this project signs sessions with asymmetric keys, so the session is
// checked here with the Auth server (getUser) before anything else happens.
import { createClient } from "npm:@supabase/supabase-js@2";
import { handle, type Rpc } from "./handler.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" } });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return reply(405, { error: "action" });

  const url = Deno.env.get("SUPABASE_URL")!;
  const authorization = req.headers.get("Authorization") ?? "";
  const token = authorization.replace(/^Bearer\s+/i, "");
  if (!token) return reply(401, { error: "not_authenticated" });
  const options = { auth: { persistSession: false, autoRefreshToken: false } };
  const asCaller = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { ...options, global: { headers: { Authorization: authorization } } });

  // a signed-in person only: the public key alone is not enough
  const { data, error } = await asCaller.auth.getUser(token);
  if (error || !data.user) return reply(401, { error: "not_authenticated" });

  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, options);
  const rpcOf = (client: ReturnType<typeof createClient>): Rpc => async (fn, args) => {
    const r = await client.rpc(fn, args);
    return { data: r.data, error: r.error ? r.error.message : null };
  };

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return reply(400, { error: "action" });
  }

  const result = await handle(body, {
    caller: rpcOf(asCaller),
    server: rpcOf(admin),
    auth: {
      async createUser(email, name) {
        const r = await admin.auth.admin.createUser({ email, email_confirm: true, user_metadata: name ? { name } : {} });
        if (r.data.user) return { id: r.data.user.id };
        const exists = r.error?.code === "email_exists" || /already (been )?registered/i.test(r.error?.message ?? "");
        if (!exists) console.error("[createUser]", r.error?.message);
        return { exists, error: r.error?.message };
      },
      async recoveryLink(email, redirectTo) {
        const r = await admin.auth.admin.generateLink({ type: "recovery", email, options: { redirectTo } });
        if (r.data.user && r.data.properties) return { link: r.data.properties.action_link, userId: r.data.user.id };
        const notFound = r.error?.code === "user_not_found" || /not found/i.test(r.error?.message ?? "");
        if (!notFound) console.error("[generateLink]", r.error?.message);
        return { notFound, error: r.error?.message };
      },
      async deleteUser(id) {
        const r = await admin.auth.admin.deleteUser(id);
        if (!r.error || r.error.code === "user_not_found") return {};
        console.error("[deleteUser]", r.error.message);
        return { error: r.error.message };
      },
    },
  });
  return reply(result.status, result.body);
});
