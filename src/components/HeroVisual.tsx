"use client";

import Image from "next/image";
import { motion } from "framer-motion";

/**
 * Hero portrait area. Shows the real portrait uploaded in Admin → Settings (heroImage).
 * Until one is uploaded, an elegant monogram frame is shown — never a stock photo of another person.
 */
export function HeroVisual({ image, alt, labels, badges = [] }: { image?: string; alt: string; labels: { a: string; b: string; c: string }; badges?: (string | null | undefined)[] }) {
  return (
    <div className="relative mx-auto aspect-[4/5] w-full max-w-md">
      {/* orbit rings */}
      <motion.div
        className="absolute -inset-6 rounded-[2.5rem] border border-white/10"
        animate={{ rotate: 360 }}
        transition={{ duration: 80, repeat: Infinity, ease: "linear" }}
        aria-hidden="true"
      />
      <div className="absolute -inset-3 rounded-[2.2rem] bg-gradient-to-br from-gold/50 via-brand/40 to-transparent opacity-70 blur-[2px]" aria-hidden="true" />

      <div className="fade-up relative h-full overflow-hidden rounded-[2rem] border border-white/15 bg-navy-700 shadow-2xl" style={{ animationDelay: "150ms" }}>
        {image ? (
          <Image src={image} alt={alt} fill priority sizes="(min-width:1024px) 420px, 80vw" className="object-cover object-[50%_18%]" />
        ) : (
          <div className="absolute inset-0 grid place-items-center bg-gradient-to-br from-navy-700 via-navy-600 to-brand-600" role="img" aria-label={alt}>
            <div className="grid-bg absolute inset-0" />
            <div className="relative text-center">
              <div className="mx-auto grid h-36 w-36 place-items-center rounded-full border-2 border-gold/70 bg-navy/40 backdrop-blur" dir="ltr">
                <span className="text-5xl font-extrabold tracking-tight text-white">
                  D<span className="text-gold">Z</span>
                </span>
              </div>
              <p className="mt-6 text-lg font-semibold text-white" dir="ltr">
                Daw Zainelabideen
              </p>
              <p className="mt-1 text-sm text-white/60" dir="ltr">PMP® · PMI-RMP® · PMI-ACP®</p>
            </div>
          </div>
        )}
        <div className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-navy/80 to-transparent" aria-hidden="true" />
      </div>

      {/* floating credential badges */}
      {[
        { label: labels.a, img: badges[0], cls: "-start-4 top-10 sm:-start-10", delay: 0.5, color: "bg-white text-navy" },
        { label: labels.b, img: badges[1], cls: "-end-3 top-1/2 sm:-end-8", delay: 0.7, color: "bg-gold text-navy" },
        { label: labels.c, img: badges[2], cls: "-start-2 bottom-10 sm:-start-6", delay: 0.9, color: "bg-brand text-white" },
      ].map((b, i) => (
        <motion.div
          key={b.label}
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: [0, -8, 0] }}
          transition={{ opacity: { delay: b.delay, duration: 0.5 }, y: { delay: b.delay, duration: 6 + i, repeat: Infinity, ease: "easeInOut" } }}
          className={b.img ? `absolute ${b.cls} h-20 w-20 overflow-hidden rounded-full bg-white p-0.5 shadow-xl ring-4 ring-white/20 sm:h-24 sm:w-24` : `absolute ${b.cls} rounded-xl px-4 py-2.5 text-sm font-bold shadow-xl ${b.color}`}
          dir="ltr"
        >
          {b.img ? <Image src={b.img} alt={b.label} width={96} height={96} className="h-full w-full rounded-full object-cover" /> : b.label}
        </motion.div>
      ))}
    </div>
  );
}

/** Animated background: a subtle project timeline / Gantt drifting behind the hero copy */
export function HeroBackdrop() {
  return (
    <svg className="pointer-events-none absolute inset-0 h-full w-full" preserveAspectRatio="xMidYMid slice" viewBox="0 0 1200 700" aria-hidden="true">
      <defs>
        <linearGradient id="hb-line" x1="0" x2="1">
          <stop offset="0" stopColor="#3B8BD0" stopOpacity="0" />
          <stop offset=".5" stopColor="#3B8BD0" stopOpacity=".55" />
          <stop offset="1" stopColor="#C5A15A" stopOpacity=".8" />
        </linearGradient>
      </defs>
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <motion.rect
          key={i}
          x={80 + i * 110}
          y={140 + i * 70}
          height="10"
          rx="5"
          fill={i === 5 ? "#C5A15A" : "#D9EAF7"}
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
