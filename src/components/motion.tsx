"use client";

import { motion, useInView, useReducedMotion, animate, MotionConfig } from "framer-motion";
import { useEffect, useRef, useState, type ReactNode } from "react";

export function MotionProvider({ children }: { children: ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}

/** Fade + slide-up when the element enters the viewport */
export function Reveal({
  children,
  delay = 0,
  className,
  y = 24,
  as = "div",
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
  y?: number;
  as?: "div" | "li" | "section" | "article";
}) {
  const M = motion[as];
  return (
    <M
      className={className}
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-60px" }}
      transition={{ duration: 0.6, delay, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </M>
  );
}

/** Animated counter — only for verified numbers entered in the admin dashboard */
export function Counter({ value, prefix = "", suffix = "", animateIt = true }: { value: number; prefix?: string; suffix?: string; animateIt?: boolean }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: "-40px" });
  const reduce = useReducedMotion();
  const [display, setDisplay] = useState(animateIt && !reduce ? 0 : value);

  useEffect(() => {
    if (!inView || !animateIt || reduce) {
      setDisplay(value);
      return;
    }
    const controls = animate(0, value, {
      duration: 1.6,
      ease: [0.22, 1, 0.36, 1],
      onUpdate: (v) => setDisplay(Math.round(v)),
    });
    return () => controls.stop();
  }, [inView, value, animateIt, reduce]);

  return (
    <span ref={ref} dir="ltr" className="tabular-nums">
      {prefix}
      {display}
      {suffix}
    </span>
  );
}

/** Animated progress bar (fills when visible) */
export function ProgressBar({ value, label }: { value: number; label?: string }) {
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-sky" role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
      <motion.div
        className="h-full rounded-full bg-gradient-to-r from-brand to-gold"
        initial={{ width: 0 }}
        whileInView={{ width: `${value}%` }}
        viewport={{ once: true }}
        transition={{ duration: 1.1, ease: [0.22, 1, 0.36, 1] }}
      />
    </div>
  );
}
