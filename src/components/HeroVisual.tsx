"use client";

import Image from "next/image";
import Link from "next/link";
import { motion } from "framer-motion";

type Track = { code: string; label: string; href: string };

/**
 * Hero panel (no personal photo): Al Daleel Raqamee logo, the PMI® Authorized Training Partner seal
 * and the certification tracks offered, with animated progress lines.
 */
export function HeroVisual({ logo, logoAlt, atpBadge, atpLabel, title, tracks }: { logo: string; logoAlt: string; atpBadge?: string; atpLabel: string; title: string; tracks: Track[] }) {
  return (
    <div className="relative mx-auto w-full max-w-md">
      <motion.div
        className="absolute -inset-6 rounded-[2.5rem] border border-white/10"
        animate={{ rotate: 360 }}
        transition={{ duration: 90, repeat: Infinity, ease: "linear" }}
        aria-hidden="true"
      />
      <div className="absolute -inset-3 rounded-[2.2rem] bg-gradient-to-br from-gold/45 via-brand/40 to-transparent opacity-70 blur-[2px]" aria-hidden="true" />

      <div className="fade-up relative overflow-hidden rounded-[2rem] border border-white/15 bg-navy-700/90 p-7 shadow-2xl backdrop-blur sm:p-8" style={{ animationDelay: "150ms" }}>
        <div className="grid-bg absolute inset-0 opacity-60" aria-hidden="true" />
        <div className="relative flex items-center justify-between gap-4">
          <Image src={logo} alt={logoAlt} width={480} height={337} priority className="h-12 w-auto" />
          {atpBadge && (
            <span className="flex items-center gap-2 rounded-full bg-white/95 py-1 pe-3 ps-1 shadow-lg">
              <Image src={atpBadge} alt={atpLabel} width={40} height={40} className="h-9 w-9 rounded-full object-contain" />
              <span className="max-w-[9rem] text-[11px] font-bold leading-tight text-navy">{atpLabel}</span>
            </span>
          )}
        </div>
        <p className="relative mt-7 text-sm font-semibold text-white/70">{title}</p>
        <ul className="relative mt-4 space-y-3">
          {tracks.map((tr, i) => (
            <li key={tr.code}>
              <Link href={tr.href} className="group block rounded-xl border border-white/10 bg-white/5 p-3.5 transition hover:border-gold/60 hover:bg-white/10">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-bold text-white" dir="ltr">
                    {tr.code}
                  </span>
                  <span className="truncate text-xs text-white/60">{tr.label}</span>
                </div>
                <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-white/10">
                  <motion.div
                    className="h-full rounded-full bg-gradient-to-r from-brand-400 to-gold"
                    initial={{ width: 0 }}
                    animate={{ width: `${92 - i * 14}%` }}
                    transition={{ delay: 0.5 + i * 0.15, duration: 1.2, ease: [0.22, 1, 0.36, 1] }}
                  />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
/** Animated background: a subtle project timeline / Gantt drifting behind the hero copy */
export function HeroBackdrop() {
  return (
    <svg className="pointer-events-none absolute inset-0 h-full w-full" preserveAspectRatio="xMidYMid slice" viewBox="0 0 1200 700" aria-hidden="true">
      <defs>
        <linearGradient id="hb-line" x1="0" x2="1">
          <stop offset="0" stopColor="#5A62C4" stopOpacity="0" />
          <stop offset=".5" stopColor="#5A62C4" stopOpacity=".55" />
          <stop offset="1" stopColor="#E23337" stopOpacity=".8" />
        </linearGradient>
      </defs>
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <motion.rect
          key={i}
          x={80 + i * 110}
          y={140 + i * 70}
          height="10"
          rx="5"
          fill={i === 5 ? "#E23337" : "#E3E5F5"}
          fillOpacity={i === 5 ? 0.35 : 0.08}
          initial={{ width: 0 }}
          animate={{ width: 220 + (i % 3) * 60 }}
          transition={{ delay: 0.3 + i * 0.15, duration: 1.2, ease: [0.22, 1, 0.36, 1] }}
        />
      ))}
      <motion.path
        d="M0 620 C 220 560, 380 600, 560 500 S 900 380, 1200 300"
        fill="none"
        stroke="url(#hb-line)"
        strokeWidth="2"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 2.4, ease: "easeInOut", delay: 0.4 }}
      />
    </svg>
  );
}
