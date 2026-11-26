"use client";

import { useCallback, useEffect, useRef, useState, type PointerEvent as RPointerEvent, type ReactNode } from "react";
import { evaluate, fmtNumber } from "@/lib/exams/calc";
import { resumeProctor, suppressProctor } from "@/lib/exams/proctor";
import { cn } from "@/lib/utils";
import type { ExamLabels } from "./ExamShell";

/* ───────────── floating panel (draggable on desktop, bottom sheet on phones) ───────────── */

export function FloatingPanel({ title, onClose, children, width: wanted = 320, start, closeLabel }: { title: string; onClose: () => void; children: ReactNode; width?: number; start: { x: number; y: number }; closeLabel: string }) {
  // never wider than the window, and opened fully inside it
  const width = typeof window === "undefined" ? wanted : Math.min(wanted, window.innerWidth - 16);
  const [pos, setPos] = useState(() => (typeof window === "undefined" ? start : { x: Math.max(8, Math.min(start.x, window.innerWidth - width - 8)), y: start.y }));
  const [small, setSmall] = useState(false);
  const drag = useRef<{ dx: number; dy: number } | null>(null);
  useEffect(() => {
    const m = window.matchMedia("(max-width: 639px)");
    const on = () => setSmall(m.matches);
    on();
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);
  const down = (e: RPointerEvent) => {
    if (small) return;
    drag.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const move = (e: RPointerEvent) => {
    if (!drag.current) return;
    setPos({ x: Math.min(Math.max(0, e.clientX - drag.current.dx), window.innerWidth - 120), y: Math.min(Math.max(0, e.clientY - drag.current.dy), window.innerHeight - 60) });
  };
  return (
    <div
      role="dialog"
      aria-label={title}
      className={cn("fixed z-[80] flex flex-col overflow-hidden border border-line bg-white shadow-2xl", small ? "inset-x-0 bottom-0 max-h-[75vh] rounded-t-2xl" : "rounded-2xl")}
      style={small ? undefined : { left: pos.x, top: pos.y, width }}
    >
      <div onPointerDown={down} onPointerMove={move} onPointerUp={() => (drag.current = null)} className={cn("flex items-center justify-between gap-2 bg-navy px-4 py-2.5 text-white", !small && "cursor-move touch-none")}>
        <span className="font-semibold">{title}</span>
        <button type="button" onClick={onClose} className="rounded-lg px-2 py-0.5 text-white/80 hover:bg-white/10 hover:text-white" aria-label={closeLabel}>✕</button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">{children}</div>
    </div>
  );
}

/* ───────────── calculator ───────────── */

const KEYS = ["C", "⌫", "(", ")", "√", "x²", "%", "÷", "7", "8", "9", "×", "4", "5", "6", "−", "1", "2", "3", "+", "±", "0", ".", "="] as const;

export function Calculator({ labels }: { labels: ExamLabels }) {
  const t = labels.tools;
  const [expr, setExpr] = useState("");
  const [last, setLast] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => box.current?.focus(), []);

  const press = useCallback(
    (k: string) => {
      setError(false);
      if (k === "C") { setExpr(""); setLast(null); return; }
      if (k === "⌫") { setExpr((e) => e.slice(0, -1)); return; }
      if (k === "=") {
        const v = evaluate(expr);
        if (v === null) { setError(true); return; }
        setLast(`${expr} =`);
        setExpr(fmtNumber(v));
        return;
      }
      if (k === "x²") { setExpr((e) => (e ? `(${e})^2` : e)); return; }
      if (k === "√") { setExpr((e) => `${e}√(`); return; }
      if (k === "±") { setExpr((e) => (e ? `-(${e})` : "-")); return; }
      setExpr((e) => (e.length > 120 ? e : e + k));
    },
    [expr],
  );

  const onKey = (e: React.KeyboardEvent) => {
    const map: Record<string, string> = { "*": "×", "/": "÷", "-": "−", Enter: "=", "=": "=", Backspace: "⌫", Escape: "C", Delete: "C" };
    const k = map[e.key] ?? (/^[0-9.+()%^]$/.test(e.key) ? e.key : null);
    if (k) {
      e.preventDefault();
      e.stopPropagation();
      press(k);
    }
  };

  return (
    <div ref={box} tabIndex={0} onKeyDown={onKey} className="space-y-3 p-3 outline-none" dir="ltr">
      <div className="rounded-xl bg-mist px-3 py-2 text-end">
        <p className="h-5 truncate text-xs text-slate">{last ?? ""}</p>
        <p className={cn("truncate font-mono text-2xl font-semibold", error ? "text-gold-600" : "text-navy")} aria-live="polite">{error ? t.calcError : expr || "0"}</p>
      </div>
      <div className="grid grid-cols-4 gap-1.5">
        {KEYS.map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => press(k)}
            aria-label={k === "C" ? t.clear : k === "⌫" ? t.backspace : k}
            className={cn(
              "h-11 rounded-lg text-lg font-semibold transition active:scale-95",
              k === "=" ? "bg-brand text-white hover:bg-brand-600" : /^[0-9.]$/.test(k) ? "bg-white text-navy ring-1 ring-line hover:bg-mist" : k === "C" ? "bg-gold/10 text-gold-600" : "bg-mist text-navy hover:bg-line",
            )}
          >
            {k}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ───────────── whiteboard ───────────── */

type Tool = "pen" | "line" | "rect" | "ellipse" | "text" | "eraser";
type El =
  | { k: "pen"; pts: [number, number][]; c: string; w: number }
  | { k: "line" | "rect" | "ellipse"; x1: number; y1: number; x2: number; y2: number; c: string; w: number }
  | { k: "text"; x: number; y: number; s: string; c: string; size: number };

const W = 1600;
const H = 1100;
const COLORS = ["#06152A", "#E23337", "#3C439B", "#0F9D58"];
const WIDTHS = [2, 4, 8];

function draw(ctx: CanvasRenderingContext2D, el: El) {
  ctx.strokeStyle = el.c;
  ctx.fillStyle = el.c;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  if (el.k === "pen") {
    ctx.lineWidth = el.w;
    ctx.beginPath();
    el.pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    if (el.pts.length === 1) ctx.lineTo(el.pts[0][0] + 0.1, el.pts[0][1]);
    ctx.stroke();
  } else if (el.k === "line") {
    ctx.lineWidth = el.w;
    ctx.beginPath();
    ctx.moveTo(el.x1, el.y1);
    ctx.lineTo(el.x2, el.y2);
    ctx.stroke();
  } else if (el.k === "rect") {
    ctx.lineWidth = el.w;
    ctx.strokeRect(Math.min(el.x1, el.x2), Math.min(el.y1, el.y2), Math.abs(el.x2 - el.x1), Math.abs(el.y2 - el.y1));
  } else if (el.k === "ellipse") {
    ctx.lineWidth = el.w;
    ctx.beginPath();
    ctx.ellipse((el.x1 + el.x2) / 2, (el.y1 + el.y2) / 2, Math.abs(el.x2 - el.x1) / 2, Math.abs(el.y2 - el.y1) / 2, 0, 0, Math.PI * 2);
    ctx.stroke();
  } else if (el.k === "text") {
    ctx.font = `${el.size}px system-ui, sans-serif`;
    ctx.fillText(el.s, el.x, el.y);
  }
}

const distSeg = (px: number, py: number, x1: number, y1: number, x2: number, y2: number) => {
  const dx = x2 - x1, dy = y2 - y1;
  const len = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / len));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
};
function hit(el: El, x: number, y: number) {
  const tol = 10;
  if (el.k === "pen") return el.pts.some(([a, b], i) => (i ? distSeg(x, y, el.pts[i - 1][0], el.pts[i - 1][1], a, b) : Math.hypot(x - a, y - b)) < el.w + tol);
  if (el.k === "line") return distSeg(x, y, el.x1, el.y1, el.x2, el.y2) < el.w + tol;
  if (el.k === "text") return x >= el.x - tol && x <= el.x + el.s.length * el.size * 0.6 + tol && y >= el.y - el.size - tol && y <= el.y + tol;
  const [l, r, t, b] = [Math.min(el.x1, el.x2), Math.max(el.x1, el.x2), Math.min(el.y1, el.y2), Math.max(el.y1, el.y2)];
  return x >= l - tol && x <= r + tol && y >= t - tol && y <= b + tol;
}

/** Scratch board for working out answers. Saved only in this browser (per attempt) — never part of the official answers. */
export function Whiteboard({ storageKey, labels }: { storageKey: string; labels: ExamLabels }) {
  const wb = labels.tools.wb;
  const canvas = useRef<HTMLCanvasElement>(null);
  const [els, setEls] = useState<El[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(storageKey) ?? "[]") as El[];
    } catch {
      return [];
    }
  });
  const [tool, setTool] = useState<Tool>("pen");
  const [color, setColor] = useState(COLORS[0]);
  const [width, setWidth] = useState(WIDTHS[1]);
  const [zoom, setZoom] = useState(0.6);
  const draft = useRef<El | null>(null);
  const down = useRef(false);

  const render = useCallback(() => {
    const cv = canvas.current;
    if (!cv) return;
    const dpr = window.devicePixelRatio || 1;
    cv.width = Math.round(W * zoom * dpr);
    cv.height = Math.round(H * zoom * dpr);
    const ctx = cv.getContext("2d")!;
    ctx.setTransform(zoom * dpr, 0, 0, zoom * dpr, 0, 0);
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = "#eef1f6";
    ctx.lineWidth = 1;
    for (let x = 40; x < W; x += 40) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
    for (let y = 40; y < H; y += 40) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
    els.forEach((e) => draw(ctx, e));
    if (draft.current) draw(ctx, draft.current);
  }, [els, zoom]);

  useEffect(() => {
    render();
    try {
      localStorage.setItem(storageKey, JSON.stringify(els.slice(-500)));
    } catch {
      /* storage full: the board still works for this session */
    }
  }, [els, render, storageKey]);

  const at = (e: RPointerEvent): [number, number] => {
    const r = canvas.current!.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * W, ((e.clientY - r.top) / r.height) * H];
  };
  const erase = (x: number, y: number) =>
    setEls((cur) => {
      for (let i = cur.length - 1; i >= 0; i--) if (hit(cur[i], x, y)) return [...cur.slice(0, i), ...cur.slice(i + 1)];
      return cur;
    });

  const onDown = (e: RPointerEvent) => {
    e.preventDefault();
    const [x, y] = at(e);
    if (tool === "text") {
      suppressProctor(120000); // the prompt dialog takes focus — not "leaving the exam"
      const s = window.prompt(wb.textPrompt);
      resumeProctor();
      if (s && s.trim()) setEls((cur) => [...cur, { k: "text", x, y, s: s.slice(0, 200), c: color, size: 14 + width * 4 }]);
      return;
    }
    canvas.current!.setPointerCapture(e.pointerId);
    down.current = true;
    if (tool === "eraser") return erase(x, y);
    draft.current = tool === "pen" ? { k: "pen", pts: [[x, y]], c: color, w: width } : { k: tool, x1: x, y1: y, x2: x, y2: y, c: color, w: width };
    render();
  };
  const onMove = (e: RPointerEvent) => {
    if (!down.current) return;
    const [x, y] = at(e);
    if (tool === "eraser") return erase(x, y);
    const d = draft.current;
    if (!d) return;
    if (d.k === "pen") d.pts.push([x, y]);
    else if (d.k !== "text") { d.x2 = x; d.y2 = y; }
    render();
  };
  const onUp = () => {
    down.current = false;
    if (draft.current) {
      const d = draft.current;
      draft.current = null;
      setEls((cur) => [...cur, d]);
    }
  };

  const toolBtn = (k: Tool, label: string, icon: string) => (
    <button key={k} type="button" onClick={() => setTool(k)} aria-pressed={tool === k} title={label} aria-label={label} className={cn("grid h-9 w-9 place-items-center rounded-lg text-base", tool === k ? "bg-navy text-white" : "bg-mist text-navy hover:bg-line")}>
      {icon}
    </button>
  );

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-1.5 border-b border-line p-2">
        {toolBtn("pen", wb.pen, "✎")}
        {toolBtn("line", wb.line, "╱")}
        {toolBtn("rect", wb.rect, "▭")}
        {toolBtn("ellipse", wb.ellipse, "◯")}
        {toolBtn("text", wb.text, "T")}
        {toolBtn("eraser", wb.eraser, "⌫")}
        <span className="mx-1 h-6 w-px bg-line" aria-hidden="true" />
        {COLORS.map((c) => (
          <button key={c} type="button" onClick={() => setColor(c)} aria-label={`${wb.color} ${c}`} aria-pressed={color === c} className={cn("h-7 w-7 rounded-full ring-offset-2", color === c && "ring-2 ring-brand")} style={{ background: c }} />
        ))}
        <span className="mx-1 h-6 w-px bg-line" aria-hidden="true" />
        {WIDTHS.map((w) => (
          <button key={w} type="button" onClick={() => setWidth(w)} aria-label={`${wb.size} ${w}`} aria-pressed={width === w} className={cn("grid h-8 w-8 place-items-center rounded-lg", width === w ? "bg-navy" : "bg-mist")}>
            <span className={cn("rounded-full", width === w ? "bg-white" : "bg-navy")} style={{ width: w + 2, height: w + 2 }} />
          </button>
        ))}
        <span className="ms-auto flex gap-1.5">
          <button type="button" onClick={() => setZoom((z) => Math.max(0.3, +(z - 0.15).toFixed(2)))} className="h-9 rounded-lg bg-mist px-2.5 text-navy" aria-label={wb.zoomOut}>−</button>
          <button type="button" onClick={() => setZoom((z) => Math.min(2, +(z + 0.15).toFixed(2)))} className="h-9 rounded-lg bg-mist px-2.5 text-navy" aria-label={wb.zoomIn}>+</button>
          <button type="button" onClick={() => setEls((cur) => cur.slice(0, -1))} disabled={!els.length} className="h-9 rounded-lg bg-mist px-2.5 text-sm text-navy disabled:opacity-40">{wb.undo}</button>
          <button type="button" onClick={() => els.length && window.confirm(wb.confirmClear) && setEls([])} className="h-9 rounded-lg px-2.5 text-sm text-gold-600 hover:bg-gold/10">{wb.clearAll}</button>
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto bg-mist p-2" dir="ltr">
        <canvas
          ref={canvas}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
          style={{ width: W * zoom, height: H * zoom, touchAction: "none", cursor: tool === "eraser" ? "cell" : tool === "text" ? "text" : "crosshair" }}
          className="rounded-lg shadow-sm"
          aria-label={labels.tools.whiteboard}
        />
      </div>
      <p className="border-t border-line px-3 py-1.5 text-xs text-slate">{wb.note}</p>
    </div>
  );
}
