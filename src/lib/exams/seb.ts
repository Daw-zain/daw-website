/**
 * Safe Exam Browser, browser side. SEB offers the page a value only it can know cheaply
 * (SHA256(page address + Config Key), safeexambrowser.org/developer/seb-integration.html). The page passes it to
 * the database with the exam requests; the database decides (supabase/exams-seb.sql).
 */
import { withBase } from "@/lib/env-public";

type SebApi = { version?: string; security?: { configKey?: string; updateKeys?: (done: () => void) => void } };
const api = (): SebApi | undefined => (typeof window === "undefined" ? undefined : (window as unknown as { SafeExamBrowser?: SebApi }).SafeExamBrowser);

/** is this window Safe Exam Browser (whether or not its configuration is accepted)? */
export const insideSeb = () => !!api() || (typeof navigator !== "undefined" && /\bSEB[ /]/.test(navigator.userAgent));

const noHash = (u: string) => u.split("#")[0];

/** the request headers that prove SEB; empty in any other browser */
export async function sebHeaders(): Promise<Record<string, string>> {
  const seb = api();
  if (!seb?.security) return {};
  // asks SEB for the value of the address shown now (needed on some versions, harmless on the others)
  const update = seb.security.updateKeys;
  if (update) {
    await new Promise<void>((done) => {
      const timer = setTimeout(done, 1500);
      try {
        update.call(seb.security, () => {
          clearTimeout(timer);
          done();
        });
      } catch {
        clearTimeout(timer);
        done();
      }
    });
  }
  const hash = seb.security.configKey;
  if (!hash) return {};
  const url = noHash(window.location.href);
  const first = performance.getEntriesByType("navigation")[0]?.name;
  return { "x-seb-hash": hash, "x-seb-url": url, "x-seb-load-url": first ? noHash(first) : url };
}

/** fetch for the data client: exam requests carry the proof when the page runs inside SEB */
export const sebFetch: typeof fetch = async (input, init) => {
  const target = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (!target.includes("/rest/v1/rpc/exam_") || !api()) return fetch(input, init);
  const extra = await sebHeaders();
  const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
  for (const [k, v] of Object.entries(extra)) headers.set(k, v);
  return fetch(input, { ...init, headers });
};

export const SEB_DOWNLOAD = "https://safeexambrowser.org/download_en.html";
export const SEB_FILE = () => withBase("/seb/daleel.seb");
export const SEB_QUIT = () => withBase("/seb/quit.html");
/** a link that opens the program with the platform's configuration */
export const sebLaunchLink = () => `${window.location.protocol === "https:" ? "sebs" : "seb"}://${window.location.host}${SEB_FILE()}`;
export const isSebError = (e: unknown) => /seb_required/.test((e as Error)?.message ?? "");
