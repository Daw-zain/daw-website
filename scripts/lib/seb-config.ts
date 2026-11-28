/**
 * The Safe Exam Browser configuration of the platform and its Config Key.
 * Rules: https://safeexambrowser.org/developer/seb-config-key.html — the key is the SHA-256 of the settings
 * written as compact JSON ("SEB-JSON"): keys sorted without regard to case, no spaces, no escaping.
 * Only the settings present in the file count.
 */
import { createHash } from "node:crypto";

export type SebValue = string | number | boolean | SebValue[] | { [k: string]: SebValue };

/** site: "https://host/base/" — everything SEB opens and signs starts with it */
export function platformSettings(site: string): Record<string, SebValue> {
  if (!/^https?:\/\/[^"\\\s<>&]+\/$/.test(site)) throw new Error('The site address must look like "https://example.org/path/"');
  return {
    allowQuit: true,
    browserWindowWebView: 3, // the modern engine, which offers the keys to the page on macOS / iPad
    quitURL: `${site}seb/quit.html`, // opening this page closes SEB
    quitURLConfirm: false,
    sendBrowserExamKey: true,
    startURL: `${site}ar/exams/`,
  };
}

const byName = (a: string, b: string) => {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  return x < y ? -1 : x > y ? 1 : 0;
};

export function sebJson(v: SebValue): string {
  if (typeof v === "string") return `"${v}"`;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return `[${v.map(sebJson).join(",")}]`;
  return `{${Object.keys(v)
    .filter((k) => k !== "originatorVersion" && !(typeof v[k] === "object" && !Array.isArray(v[k]) && !Object.keys(v[k] as object).length))
    .sort(byName)
    .map((k) => `"${k}":${sebJson(v[k])}`)
    .join(",")}}`;
}

export const configKey = (settings: Record<string, SebValue>) => createHash("sha256").update(sebJson(settings), "utf8").digest("hex");

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const node = (v: SebValue): string => {
  if (typeof v === "string") return `<string>${esc(v)}</string>`;
  if (typeof v === "boolean") return v ? "<true/>" : "<false/>";
  if (typeof v === "number") return `<integer>${v}</integer>`;
  if (Array.isArray(v)) return `<array>${v.map(node).join("")}</array>`;
  return `<dict>${Object.keys(v).sort(byName).map((k) => `<key>${esc(k)}</key>${node(v[k])}`).join("")}</dict>`;
};

/** an unencrypted .seb file (a property list) */
export const sebFile = (settings: Record<string, SebValue>) =>
  `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0">${node(settings)}</plist>\n`;
