/**
 * PDF → lines of text in reading order (pdf.js gives positioned pieces, not lines).
 * Arabic: many PDFs store shaped letters (presentation forms) in visual order, so pieces are read right to left,
 * runs of Latin letters and digits keep their own direction, mirrored brackets are turned back, and
 * the shapes are normalised to ordinary letters. Scanned pages (pictures) carry no text.
 */

export type PdfPiece = { str: string; x: number; y: number; w: number; h: number };
export type PdfPage = { pieces: PdfPiece[]; height: number };
export const MAX_PDF_PAGES = 300;

const RTL = /[֐-ࣿיִ-﷿ﹰ-ﻼ]/;
const RTL_LETTER = /[א-תؠ-يٱ-ۓיִ-ﴽﵐ-ﷻﺀ-ﻼ]/;
const LTR_LETTER = /[A-Za-zÀ-ɏͰ-ϿЀ-ӿ]/;
const DIGIT = /[0-9٠-٩۰-۹]/;
const MARKS_ONLY = /^[\sً-ٰٟـﹰ-ﹿ]*[ً-ٰٟﹰ-ﹿ][\sً-ٰٟـﹰ-ﹿ]*$/;
const EDGES = /^([\s:.,;()[\]{}<>«»"'!?؟،؛–—-]*)(.*?)([\s:.,;()[\]{}<>«»"'!?؟،؛–—]*)$/;
const MIRROR: Record<string, string> = { "(": ")", ")": "(", "[": "]", "]": "[", "{": "}", "}": "{", "<": ">", ">": "<", "«": "»", "»": "«" };

/**
 * Arabic presentation shapes → ordinary letters (only these ranges: "m²" or "½" must stay as they are).
 * Many fonts share one shape between ي and ی, ه and ھ, ك and ک, and the file then names the Persian/Urdu one.
 */
const SHARED: Record<string, string> = { "ی": "ي", "ھ": "ه", "ہ": "ه", "ک": "ك" };
const unshape = (s: string) => s.replace(/[ﭐ-﷿ﹰ-ﻼ]/g, (c) => c.normalize("NFKC")).replace(/[یھہک]/g, (c) => SHARED[c]);

type Kind = "R" | "L" | "N";
const kindOf = (s: string): Kind => (RTL_LETTER.test(s) ? "R" : LTR_LETTER.test(s) || DIGIT.test(s) ? "L" : "N");

type Row = { y: number; h: number; pieces: (PdfPiece & { key: number })[] };

function rowsOf(pieces: PdfPiece[]): Row[] {
  const rows: Row[] = [];
  const marks: PdfPiece[] = [];
  for (const p of [...pieces].sort((a, b) => b.y - a.y)) {
    if (!p.str) continue;
    if (MARKS_ONLY.test(p.str)) {
      marks.push(p);
      continue;
    }
    // empty-width spaces and line ends carry no position worth a row of their own
    if (!p.str.trim() && !p.w) continue;
    const h = p.h || 10;
    const row = rows.find((r) => Math.abs(r.y - p.y) < Math.max(2, Math.min(r.h, h) * 0.45));
    if (row) {
      row.pieces.push({ ...p, key: p.x });
      if (p.str.trim()) row.h = Math.max(row.h, h);
    } else rows.push({ y: p.y, h, pieces: [{ ...p, key: p.x }] });
  }
  // vowel marks are drawn above or below their line: put each back right after the piece it sits on
  for (const m of marks) {
    const near = rows.map((r) => ({ r, d: Math.abs(r.y - m.y) })).sort((a, b) => a.d - b.d)[0];
    if (!near || near.d > near.r.h * 1.3) continue;
    const mid = m.x + m.w / 2;
    const base = near.r.pieces.find((p) => p.str.trim() && mid >= p.x - 0.5 && mid <= p.x + p.w + 0.5);
    near.r.pieces.push({ ...m, str: m.str.replace(/[\sـ]/g, ""), w: 0, key: base ? base.x - 0.01 : m.x });
  }
  return rows.filter((r) => r.pieces.some((p) => p.str.trim())).sort((a, b) => b.y - a.y);
}

/** an Arabic line: mostly Arabic letters, or it begins (at the right) with one, as in "(B) Kanban board" lines */
function isRtlRow(row: Row): boolean {
  const text = row.pieces.map((p) => p.str).join("");
  const rtl = [...text].filter((c) => RTL_LETTER.test(c)).length;
  if (!rtl) return false;
  if (rtl > [...text].filter((c) => LTR_LETTER.test(c)).length) return true;
  const letters = row.pieces.filter((p) => RTL_LETTER.test(p.str) || LTR_LETTER.test(p.str)).sort((a, b) => b.x - a.x);
  return !!letters.length && RTL_LETTER.test(letters[0].str);
}

/**
 * In a right-to-left line a piece such as ":1" is stored as drawn: its edge punctuation belongs on the other
 * side of the number, so it is handled as a piece of its own.
 */
function splitEdges(p: Row["pieces"][number]): Row["pieces"] {
  // a piece that already holds its own pair of brackets, "(Project Charter)", is in order
  if (/^[([{].*[)\]}][.,:;؟]*$/.test(p.str.trim())) return [p];
  const m = p.str.match(EDGES);
  if (!m || !m[2] || (!m[1] && !m[3])) return [p];
  const step = p.w / p.str.length;
  let x = p.x;
  return [m[1], m[2], m[3]].filter(Boolean).map((str) => {
    const part = { ...p, str, x, w: step * str.length, key: x };
    x += part.w;
    return part;
  });
}

/** one row → text in logical order; `mirror` turns brackets in right-to-left context back */
function rowText(row: Row, mirror: boolean): string {
  const rtl = isRtlRow(row);
  // "%30" as drawn inside Arabic text is 30%
  const pieces = rtl ? row.pieces.flatMap((p) => (kindOf(p.str) === "L" ? splitEdges({ ...p, str: p.str.replace(/^%([0-9٠-٩][0-9٠-٩.,]*)$/, "$1%") }) : [p])) : row.pieces;
  const list = [...pieces].sort((a, b) => (rtl ? b.key - a.key : a.key - b.key));
  // a visible gap without a space piece is still a word break
  const spaced: { str: string; kind: Kind }[] = [];
  // some writers (Word) leave spaces out: a change of script is then a word break
  const wordsOnly = !list.some((p) => !p.str.trim() || (kindOf(p.str) === "R" && /\s/.test(p.str)));
  list.forEach((p, i) => {
    const prev = list[i - 1];
    if (wordsOnly && prev && p.w && prev.w) {
      const pair = [kindOf(prev.str), kindOf(p.str)].sort().join("");
      if (pair === "LR") {
        spaced.push({ str: " ", kind: "N" }, { str: p.str, kind: kindOf(p.str) });
        return;
      }
    }
    if (prev && p.w && prev.w) {
      const gap = rtl ? prev.x - (p.x + p.w) : p.x - (prev.x + prev.w);
      if (gap > row.h * 0.25 && !/\s$/.test(prev.str) && !/^\s/.test(p.str)) spaced.push({ str: " ", kind: "N" });
    }
    spaced.push({ str: p.str, kind: kindOf(p.str) });
  });
  if (!rtl) return spaced.map((p) => p.str).join("");
  const turn = (s: string) => (mirror ? s.replace(/[()[\]{}<>«»]/g, (c) => MIRROR[c]) : s);
  let out = "";
  for (let i = 0; i < spaced.length; i++) {
    const p = spaced[i];
    const sign = (s?: string) => !!s && /^[%$€£+\-−°#]$/.test(s.trim()) && s.trim() === s;
    const startsRun = p.kind === "L" || (sign(p.str) && spaced[i + 1]?.kind === "L" && DIGIT.test(spaced[i + 1].str));
    if (!startsRun) {
      out += turn(p.str);
      continue;
    }
    // a left-to-right run: up to the last Latin / digit piece before the next Arabic one
    let end = i;
    for (let j = i; j < spaced.length && spaced[j].kind !== "R"; j++) if (spaced[j].kind === "L") end = j;
    out += spaced.slice(i, end + 1).reverse().map((x) => x.str).join("");
    i = end;
  }
  return out;
}

/** does this file draw brackets mirrored in Arabic lines? (most browsers do, some writers do not) */
function votesForMirroring(rows: Row[]): boolean {
  let yes = 0;
  let no = 0;
  for (const r of rows) {
    if (!isRtlRow(r)) continue;
    const t = unshape(rowText(r, false)).trim();
    const option = t.match(/^[أابتثجحدهوز]\s?([()])/);
    if (option) {
      if (option[1] === "(") yes++;
      else no++;
    }
    const pair = t.match(/[()][^()]*[()]/)?.[0];
    if (pair?.startsWith(")") && pair.endsWith("(")) yes++;
    if (pair?.startsWith("(") && pair.endsWith(")")) no++;
  }
  return yes > no;
}

const tidy = (s: string) =>
  unshape(s)
    .replace(/[​-‏‪-‮⁦-⁩﻿­]/g, "")
    .replace(/ /g, " ")
    .replace(/\s+([ً-ٰٟ])/g, "$1")
    // a lone final alef is the tail of the previous word (tanween splits it in some files)
    .replace(/([ء-يً-ٰٟ]) (ا[ً-ٟ]*)(?=$|[\s.,،؛:؟!)])/g, "$1$2")
    .replace(/[ \t]{3,}/g, "  ")
    .trim();

/** page number lines and headers / footers repeated on the pages */
function dropRunningLines(pages: { text: string; edge: boolean }[][]) {
  const key = (s: string) => s.replace(/[0-9٠-٩]+/g, "#");
  const seen = new Map<string, number>();
  for (const page of pages) for (const k of new Set(page.filter((l) => l.edge).map((l) => key(l.text)))) seen.set(k, (seen.get(k) ?? 0) + 1);
  const content = /^(?:السؤال|الإجابة|الشرح|التغذية|الصعوبة|الدرجة|المجال|الموضوع|المرجع|نوع السؤال|question|answer|correct|explanation|feedback|points|difficulty|domain|[([]?[A-Hأابجدهو]\s?[.)(])/i;
  const repeated = (s: string) => !content.test(s) && pages.length > 1 && (seen.get(key(s)) ?? 0) >= Math.max(2, Math.ceil(pages.length * 0.6));
  const pageNo = /^[-–—\s]*(?:(?:page|صفحة|ص)\s*)?[0-9٠-٩]{1,4}(?:\s*(?:\/|of|من)\s*[0-9٠-٩]{1,4})?[-–—\s]*$/i;
  return pages.map((page) => page.filter((l) => !(l.edge && (repeated(l.text) || pageNo.test(l.text) || /^(?:about:|https?:\/\/)\S*(\s+\d+\/\d+)?$/.test(l.text)))));
}

/** pages → lines; an empty string marks a visibly larger gap (a new block) */
export function pagesToLines(pages: PdfPage[]): string[] {
  const rowed = pages.map((p) => rowsOf(p.pieces));
  const mirror = votesForMirroring(rowed.flat());
  const gaps = rowed.flatMap((rows) => rows.slice(1).map((r, i) => (rows[i].y - r.y) / Math.max(1, r.h))).filter((g) => g > 0).sort((a, b) => a - b);
  const usual = gaps[Math.floor(gaps.length * 0.4)] ?? 1.5;
  const built = rowed.map((rows, n) =>
    rows.map((r, i) => ({
      text: tidy(rowText(r, mirror)),
      edge: r.y > pages[n].height * 0.9 || r.y < pages[n].height * 0.1,
      gap: i > 0 && (rows[i - 1].y - r.y) / Math.max(1, r.h) > usual * 1.35,
    })),
  );
  const kept = dropRunningLines(built) as typeof built;
  const out: string[] = [];
  for (const page of kept)
    for (const l of page) {
      if (!l.text) continue;
      if (l.gap && out.length && out[out.length - 1] !== "") out.push("");
      out.push(l.text);
    }
  return out;
}

/**
 * Word and others store the "لا" shapes as one glyph standing for two letters; read right to left, those two
 * come out swapped ("الصالحية" for "الصلاحية"). Glyphs arrive in drawing order, so each affected word can be
 * spelled both ways: as it is misread, and with whole glyphs turned round, which is right.
 */
export function ligatureFixes(words: string[][], fixes = new Map<string, string>()) {
  const letters = /^[ء-ٰٟ]+$/;
  // punctuation next to a word (a question mark) is not part of its spelling
  const runs = words.flatMap((w) => w.reduce<string[][]>((a, g) => (letters.test(g) ? a[a.length - 1].push(g) : a.push([]), a), [[]]));
  for (const glyphs of runs) {
    if (!glyphs.some((g) => /^[ء-ي][ً-ٟ]?[ء-ي][ً-ٟ]?$/.test(g))) continue;
    const wrong = [...glyphs.join("")].reverse().join("");
    const right = [...glyphs].reverse().join("");
    if (wrong !== right) fixes.set(wrong, right);
  }
  return fixes;
}
export const applyFixes = (lines: string[], fixes: Map<string, string>) => (fixes.size ? lines.map((l) => l.replace(/[ء-ٰٟ]+/g, (w) => fixes.get(w) ?? w)) : lines);

type PdfJs = typeof import("pdfjs-dist");

async function loadPdfJs(): Promise<PdfJs> {
  const lib = (await import("pdfjs-dist/legacy/build/pdf.mjs")) as unknown as PdfJs;
  // in the browser the reader runs in its own worker file; Node (tests) loads it by itself
  if (typeof window !== "undefined" && !lib.GlobalWorkerOptions.workerSrc) {
    lib.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/legacy/build/pdf.worker.min.mjs", import.meta.url).toString();
  }
  return lib;
}

/** reads the text of a PDF. Throws Error("pdf_password" | "not_pdf" | "file_too_large" | "pdf_reader") */
export async function readPdfLines(buffer: ArrayBuffer): Promise<string[]> {
  let lib: PdfJs;
  try {
    lib = await loadPdfJs();
  } catch {
    throw new Error("pdf_reader");
  }
  // a copy: the reader takes ownership of the bytes it is given
  const task = lib.getDocument({ data: new Uint8Array(buffer.slice(0)), isEvalSupported: false, verbosity: 0 });
  try {
    const doc = await task.promise;
    if (doc.numPages > MAX_PDF_PAGES) throw new Error("file_too_large");
    const pages: PdfPage[] = [];
    const fixes = new Map<string, string>();
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent({ disableNormalization: true });
      const pieces: PdfPiece[] = [];
      for (const it of content.items) {
        if (!("str" in it)) continue;
        pieces.push({ str: it.str, x: it.transform[4], y: it.transform[5], w: it.width, h: Math.abs(it.height || it.transform[3]) });
      }
      pages.push({ pieces, height: page.view[3] - page.view[1] });
      if (pieces.some((x) => RTL.test(x.str))) {
        const ops = await page.getOperatorList();
        const words: string[][] = [];
        ops.fnArray.forEach((fn, i) => {
          if (fn !== lib.OPS.showText) return;
          let word: string[] = [];
          for (const g of ops.argsArray[i][0] as ({ unicode?: string } | number)[]) {
            if (typeof g !== "object" || !g?.unicode) continue;
            if (g.unicode.trim()) word.push(g.unicode);
            else if (word.length) (words.push(word), (word = []));
          }
          if (word.length) words.push(word);
        });
        ligatureFixes(words, fixes);
      }
    }
    return applyFixes(pagesToLines(pages), fixes);
  } catch (e) {
    const err = e as Error;
    if (err.name === "PasswordException") throw new Error("pdf_password");
    if (err.message === "file_too_large") throw err;
    throw new Error("not_pdf");
  } finally {
    await task.destroy();
  }
}
