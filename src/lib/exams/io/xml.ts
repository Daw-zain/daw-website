/**
 * A small, strict-enough XML reader for Moodle XML and Excel (.xlsx) parts.
 * No DTD processing and no external entities are ever resolved (a DOCTYPE is skipped) — safe for untrusted files.
 * Works the same in the browser and in Node (tests).
 */
export type XNode = { name: string; attrs: Record<string, string>; children: XNode[]; text: string };

const ENT: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
export const decodeEntities = (s: string) =>
  s.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (m, e: string) => {
    if (e[0] === "#") {
      const cp = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(cp) && cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : "";
    }
    return ENT[e] ?? m;
  });

export class XmlError extends Error {}

export function parseXml(src: string): XNode {
  const root: XNode = { name: "#root", attrs: {}, children: [], text: "" };
  const stack: XNode[] = [root];
  let i = 0;
  const n = src.length;
  if (src.charCodeAt(0) === 0xfeff) i = 1;
  while (i < n) {
    const lt = src.indexOf("<", i);
    const top = stack[stack.length - 1];
    if (lt < 0) {
      top.text += decodeEntities(src.slice(i));
      break;
    }
    if (lt > i) top.text += decodeEntities(src.slice(i, lt));
    if (src.startsWith("<!--", lt)) {
      const e = src.indexOf("-->", lt + 4);
      if (e < 0) throw new XmlError("unclosed comment");
      i = e + 3;
    } else if (src.startsWith("<![CDATA[", lt)) {
      const e = src.indexOf("]]>", lt + 9);
      if (e < 0) throw new XmlError("unclosed CDATA");
      top.text += src.slice(lt + 9, e);
      i = e + 3;
    } else if (src.startsWith("<?", lt)) {
      const e = src.indexOf("?>", lt + 2);
      if (e < 0) throw new XmlError("unclosed processing instruction");
      i = e + 2;
    } else if (src.startsWith("<!", lt)) {
      // DOCTYPE / declarations: skipped entirely (no entity definitions are honoured)
      let depth = 0;
      let j = lt + 2;
      for (; j < n; j++) {
        if (src[j] === "[") depth++;
        else if (src[j] === "]") depth--;
        else if (src[j] === ">" && depth <= 0) break;
      }
      i = j + 1;
    } else if (src[lt + 1] === "/") {
      const e = src.indexOf(">", lt);
      if (e < 0) throw new XmlError("unclosed end tag");
      const name = src.slice(lt + 2, e).trim();
      const open = stack.pop();
      if (!open || open.name !== name) throw new XmlError(`mismatched </${name}>`);
      i = e + 1;
    } else {
      // start tag: name + attributes, maybe self-closing
      let j = lt + 1;
      let quote = "";
      for (; j < n; j++) {
        const ch = src[j];
        if (quote) {
          if (ch === quote) quote = "";
        } else if (ch === '"' || ch === "'") quote = ch;
        else if (ch === ">") break;
      }
      if (j >= n) throw new XmlError("unclosed start tag");
      let body = src.slice(lt + 1, j);
      const selfClose = body.endsWith("/");
      if (selfClose) body = body.slice(0, -1);
      const m = body.match(/^([^\s/>]+)/);
      if (!m) throw new XmlError("bad tag");
      const node: XNode = { name: m[1], attrs: {}, children: [], text: "" };
      for (const a of body.slice(m[1].length).matchAll(/([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)')/g)) node.attrs[a[1]] = decodeEntities(a[3] ?? a[4] ?? "");
      top.children.push(node);
      if (!selfClose) stack.push(node);
      i = j + 1;
    }
    if (stack.length > 200) throw new XmlError("nesting too deep");
  }
  if (stack.length !== 1) throw new XmlError(`unclosed <${stack[stack.length - 1].name}>`);
  return root;
}

/** helpers (names compared without a namespace prefix, so "x:row" matches "row") */
const local = (name: string) => name.slice(name.indexOf(":") + 1);
export const kids = (n: XNode | undefined, name: string) => (n ? n.children.filter((c) => local(c.name) === name) : []);
export const kid = (n: XNode | undefined, name: string) => n?.children.find((c) => local(c.name) === name);
/** text of a Moodle "<x><text>…</text></x>" or plain element */
export const txtOf = (n: XNode | undefined): string => {
  if (!n) return "";
  const t = kid(n, "text");
  return (t ? t.text : n.text).trim();
};
export const path = (n: XNode | undefined, ...names: string[]) => names.reduce<XNode | undefined>((cur, nm) => kid(cur, nm), n);
/** all text below a node (used for Excel rich text runs) */
export const deepText = (n: XNode): string => n.text + n.children.map(deepText).join("");

export const escXml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
/** CDATA that survives "]]>" in the content */
export const cdata = (s: string) => `<![CDATA[${s.replace(/]]>/g, "]]]]><![CDATA[>")}]]>`;
