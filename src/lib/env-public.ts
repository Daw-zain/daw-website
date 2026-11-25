/** Values that are safe in the browser. */

/** true in the GitHub Pages build (static HTML + Supabase), false when running the full Next.js server locally */
export const IS_STATIC = process.env.NEXT_PUBLIC_STATIC === "1";

/** e.g. "/daw-website" on https://daw-zain.github.io/daw-website — empty on a custom domain or locally */
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || "";

/** Prefix an in-site absolute path with the base path (next/link does this itself; use for <a>, <img>, form actions, window.location). */
export function withBase(p: string) {
  return p.startsWith("/") && !p.startsWith("//") && !(BASE_PATH && p.startsWith(BASE_PATH + "/")) ? BASE_PATH + p : p;
}
