/** HTML ↔ plain text for formats that carry HTML (Moodle XML, GIFT [html]). Our questions store plain text. */
import { decodeEntities } from "./xml";

/** HTML → readable plain text (block tags become line breaks, everything else is dropped — scripts/styles included) */
export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|li|h[1-6]|tr|table|blockquote)>/gi, "\n")
      .replace(/<li[^>]*>/gi, "• ")
      .replace(/<\/t[dh]>/gi, "\t")
      .replace(/<[^>]+>/g, ""),
  )
    .replace(/ /g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** image file names referenced as @@PLUGINFILE@@/name in Moodle HTML */
export const pluginFiles = (html: string) => [...html.matchAll(/@@PLUGINFILE@@\/([^"'\s>)]+)/g)].map((m) => decodeURIComponent(m[1]));

export const escHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
/** plain text → HTML paragraph (line breaks kept) */
export const textToHtml = (s: string) => (s ? `<p>${escHtml(s).replace(/\r?\n/g, "<br>")}</p>` : "");
