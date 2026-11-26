/**
 * Exam calculator engine — a small, safe arithmetic evaluator (never uses eval / Function).
 * Supports: + − × ÷, parentheses, decimals, unary minus, postfix % (x% = x/100), √( … ), and ^ (power).
 * Returns null for anything malformed, a division by zero, or a non-finite result.
 */

type Tok = { t: "num"; v: number } | { t: "op"; v: string } | { t: "lp" } | { t: "rp" } | { t: "fn"; v: "sqrt" };

const OPS: Record<string, { p: number; right?: boolean; un?: boolean }> = {
  "+": { p: 1 },
  "-": { p: 1 },
  "*": { p: 2 },
  "/": { p: 2 },
  "^": { p: 4, right: true },
  "u-": { p: 3, right: true, un: true },
  "%": { p: 5, un: true },
};

export function tokenize(src: string): Tok[] | null {
  const s = src.replace(/×/g, "*").replace(/÷/g, "/").replace(/−/g, "-").replace(/,/g, ".").replace(/\s+/g, "");
  const out: Tok[] = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/[0-9.]/.test(c)) {
      let j = i;
      while (j < s.length && /[0-9.]/.test(s[j])) j++;
      const raw = s.slice(i, j);
      if ((raw.match(/\./g) ?? []).length > 1 || raw === ".") return null;
      out.push({ t: "num", v: Number(raw) });
      i = j;
    } else if (s.startsWith("√", i)) {
      out.push({ t: "fn", v: "sqrt" });
      i += 1;
    } else if (s.startsWith("sqrt", i)) {
      out.push({ t: "fn", v: "sqrt" });
      i += 4;
    } else if ("+-*/^%".includes(c)) {
      const prev = out[out.length - 1];
      const unary = c === "-" && (!prev || prev.t === "op" || prev.t === "lp" || prev.t === "fn") && !(prev?.t === "op" && prev.v === "%");
      out.push({ t: "op", v: unary ? "u-" : c });
      i++;
    } else if (c === "(") {
      out.push({ t: "lp" });
      i++;
    } else if (c === ")") {
      out.push({ t: "rp" });
      i++;
    } else return null;
  }
  return out;
}

export function evaluate(src: string): number | null {
  const toks = tokenize(src);
  if (!toks || toks.length === 0) return null;
  // shunting-yard → RPN
  const out: Tok[] = [];
  const st: Tok[] = [];
  for (const tk of toks) {
    if (tk.t === "num") out.push(tk);
    else if (tk.t === "fn") st.push(tk);
    else if (tk.t === "op") {
      if (tk.v === "%") {
        out.push(tk); // postfix: applies to what is already on the output
        continue;
      }
      const o = OPS[tk.v];
      while (st.length) {
        const top = st[st.length - 1];
        if (top.t === "fn") { out.push(st.pop()!); continue; }
        if (top.t !== "op") break;
        const q = OPS[top.v];
        if (o.un) break; // a prefix operator never pops anything
        if (q.p > o.p || (q.p === o.p && !o.right)) out.push(st.pop()!);
        else break;
      }
      st.push(tk);
    } else if (tk.t === "lp") st.push(tk);
    else if (tk.t === "rp") {
      while (st.length && st[st.length - 1].t !== "lp") out.push(st.pop()!);
      if (!st.length) return null;
      st.pop();
      if (st.length && st[st.length - 1].t === "fn") out.push(st.pop()!);
    }
  }
  while (st.length) {
    const tk = st.pop()!;
    if (tk.t === "lp" || tk.t === "rp") return null;
    out.push(tk);
  }
  // evaluate RPN
  const v: number[] = [];
  for (const tk of out) {
    if (tk.t === "num") v.push(tk.v);
    else if (tk.t === "fn") {
      if (!v.length) return null;
      const a = v.pop()!;
      if (a < 0) return null;
      v.push(Math.sqrt(a));
    } else if (tk.t === "op") {
      if (OPS[tk.v].un) {
        if (!v.length) return null;
        const a = v.pop()!;
        v.push(tk.v === "%" ? a / 100 : -a);
        continue;
      }
      if (v.length < 2) return null;
      const b = v.pop()!;
      const a = v.pop()!;
      if (tk.v === "/" && b === 0) return null;
      v.push(tk.v === "+" ? a + b : tk.v === "-" ? a - b : tk.v === "*" ? a * b : tk.v === "/" ? a / b : Math.pow(a, b));
    }
  }
  if (v.length !== 1 || !Number.isFinite(v[0])) return null;
  return v[0];
}

/** display: up to 12 significant digits, no floating noise (0.1+0.2 → 0.3) */
export function fmtNumber(n: number): string {
  if (Number.isInteger(n) && Math.abs(n) < 1e15) return String(n);
  const s = Number(n.toPrecision(12)).toString();
  return s;
}
