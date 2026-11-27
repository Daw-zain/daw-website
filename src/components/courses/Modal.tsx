"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

/** a panel over the page: closes with Escape or the button, and keeps the page behind from scrolling */
export function Modal({ title, close, closeLabel, wide, children }: { title: string; close: () => void; closeLabel: string; wide?: boolean; children: ReactNode }) {
  const panel = useRef<HTMLDivElement>(null);
  const onClose = useRef(close);
  onClose.current = close;

  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panel.current?.focus();
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose.current();
    window.addEventListener("keydown", key);
    return () => {
      document.body.style.overflow = overflow;
      window.removeEventListener("keydown", key);
      before?.focus?.();
    };
  }, []);

  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-start justify-center overflow-y-auto bg-navy/60 p-3 sm:p-6" dir={document.documentElement.dir || undefined}>
      <div ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title} className={`card my-auto w-full ${wide ? "max-w-4xl" : "max-w-2xl"} p-4 outline-none sm:p-6`}>
        <div className="flex items-start justify-between gap-3">
          <h2 className="min-w-0 break-words text-lg font-bold text-navy">{title}</h2>
          <button type="button" onClick={close} className="btn btn-outline btn-sm shrink-0">
            {closeLabel}
          </button>
        </div>
        <div className="mt-4">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
