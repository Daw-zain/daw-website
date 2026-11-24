import "server-only";

/**
 * Lightweight anti-spam:
 *  1. honeypot field "website" must stay empty
 *  2. form must be submitted ≥ 3s after it was rendered (field "_ts")
 *  3. in-memory rate limit per IP + form (resets on restart; use Redis behind a load balancer)
 */
const hits = new Map<string, number[]>();

export function checkSpam(form: FormData): "ok" | "spam" {
  if (String(form.get("website") ?? "").trim() !== "") return "spam";
  const ts = Number(form.get("_ts") ?? 0);
  if (!ts || Date.now() - ts < 3000) return "spam";
  if (Date.now() - ts > 1000 * 60 * 60 * 24) return "spam";
  return "ok";
}

export function rateLimit(key: string, max = 5, windowMs = 10 * 60 * 1000): boolean {
  const now = Date.now();
  const list = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (list.length >= max) {
    hits.set(key, list);
    return false;
  }
  list.push(now);
  hits.set(key, list);
  if (hits.size > 5000) {
    for (const [k, v] of hits) if (!v.some((t) => now - t < windowMs)) hits.delete(k);
  }
  return true;
}
