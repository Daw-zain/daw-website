import Link from "next/link";
import Image from "next/image";
import type { Dictionary } from "@/dictionaries/en";
import type { Locale } from "@/lib/constants";
import { ArrowIcon, CalendarIcon, ClockIcon, FileIcon, PlayIcon, ServiceIcon } from "./Icons";
import { StatusChip } from "./ui";
import { TiltCard } from "./TiltCard";
import { cn, formatDate, pick } from "@/lib/utils";

type ProgramLike = {
  slug: string;
  code: string | null;
  category: string;
  titleAr: string;
  titleEn: string;
  summaryAr: string;
  summaryEn: string;
  durationAr: string;
  durationEn: string;
  hours: number | null;
  status: string;
  image: string | null;
  sessions?: { startDate: Date }[];
};

const programArt: Record<string, string> = {
  certification: "from-navy via-navy-700 to-brand",
  management: "from-navy-700 via-brand-600 to-brand-400",
  agile: "from-brand-600 via-brand to-[#4aa3df]",
  technology: "from-navy via-[#1d3f73] to-[#6a5acd]",
  tools: "from-navy-800 via-navy-600 to-[#3d7ea6]",
};

/** Decorative, animated header for program cards (used until a real image is uploaded) */
function ProgramArt({ code, category }: { code: string | null; category: string }) {
  return (
    <div className={cn("prog-art-bg relative h-full w-full overflow-hidden bg-gradient-to-br", programArt[category] ?? programArt.management)}>
      <div className="grid-bg absolute inset-0 opacity-70 transition-transform duration-[1.2s] group-hover:scale-110" />
      <div className="absolute -end-10 -top-10 h-36 w-36 rounded-full bg-gold/20 blur-2xl transition-transform duration-700 group-hover:translate-y-6 group-hover:scale-125" />
      {/* animated mini Gantt timeline */}
      <div className="absolute inset-x-6 bottom-5 space-y-2" aria-hidden="true">
        <div className="prog-bar h-2 w-[38%] rounded-full bg-sky/60" />
        <div className="prog-bar ms-[20%] h-2 w-[42%] rounded-full bg-sky/85" />
        <div className="flex items-center gap-2 ps-[48%]">
          <div className="prog-bar h-2 flex-1 rounded-full bg-gold" />
          <span className="prog-dot h-3 w-3 shrink-0 rounded-full bg-gold" />
        </div>
      </div>
      <span className="absolute start-6 top-5 text-3xl font-extrabold tracking-tight text-white/95 drop-shadow transition-transform duration-500 group-hover:-translate-y-1 group-hover:scale-110" dir="ltr">
        {code || "PM"}
      </span>
      <span className="prog-shimmer pointer-events-none absolute inset-0" aria-hidden="true" />
    </div>
  );
}

export function ProgramCard({ p, locale, t }: { p: ProgramLike; locale: Locale; t: Dictionary }) {
  const next = p.sessions?.[0];
  const duration = pick(p, "duration", locale) || (p.hours ? `${p.hours} ${t.common.hours}` : "");
  return (
    <TiltCard>
      <Link
        href={`/${locale}/programs/${p.slug}`}
        className="card group relative flex h-full flex-col overflow-hidden transition-[box-shadow,border-color] duration-300 hover:border-brand/30 hover:shadow-lift"
      >
        <div className="relative aspect-[16/8] overflow-hidden">
          {p.image ? (
            <>
              <Image src={p.image} alt="" fill sizes="(min-width:1024px) 33vw, (min-width:640px) 50vw, 100vw" className="object-cover transition-transform duration-700 group-hover:scale-110" />
              <span className="prog-shimmer pointer-events-none absolute inset-0" aria-hidden="true" />
            </>
          ) : (
            <ProgramArt code={p.code} category={p.category} />
          )}
        </div>
        <div className="flex flex-1 flex-col p-6">
          <div className="flex flex-wrap items-center gap-2">
            <span className="chip bg-mist text-slate transition-colors group-hover:bg-sky group-hover:text-brand-600">{(t.categories.program as Record<string, string>)[p.category] ?? p.category}</span>
            <StatusChip status={p.status} label={(t.status.program as Record<string, string>)[p.status] ?? p.status} />
          </div>
          <h3 className="mt-4 text-xl font-bold leading-snug transition-colors group-hover:text-brand">{pick(p, "title", locale)}</h3>
          <p className="mt-2 line-clamp-3 text-[15px] leading-7 text-slate">{pick(p, "summary", locale)}</p>
          <div className="mt-auto flex flex-wrap items-center gap-x-5 gap-y-2 pt-5 text-sm text-slate">
            {duration && (
              <span className="inline-flex items-center gap-1.5">
                <ClockIcon className="h-4 w-4 text-brand" />
                {duration}
              </span>
            )}
            {next && (
              <span className="inline-flex items-center gap-1.5">
                <CalendarIcon className="h-4 w-4 text-brand" />
                {formatDate(next.startDate, locale, { month: "short" })}
              </span>
            )}
            <span className="ms-auto inline-flex items-center gap-1 font-semibold text-brand">
              {t.common.viewDetails}
              <ArrowIcon className="h-4 w-4 transition-transform group-hover:translate-x-1 rtl:group-hover:-translate-x-1" />
            </span>
          </div>
        </div>
        {/* progress line that fills on hover */}
        <span className="absolute inset-x-0 bottom-0 h-1 origin-left scale-x-0 bg-gradient-to-r from-brand to-gold transition-transform duration-500 group-hover:scale-x-100 rtl:origin-right" aria-hidden="true" />
      </Link>
    </TiltCard>
  );
}
export function ServiceCard({ s, locale, t }: { s: { slug: string; icon: string; titleAr: string; titleEn: string; summaryAr: string; summaryEn: string }; locale: Locale; t: Dictionary }) {
  return (
    <Link href={`/${locale}/consulting/${s.slug}`} className="card card-hover group flex h-full flex-col p-7">
      <span className="grid h-14 w-14 place-items-center rounded-2xl bg-sky text-brand transition-all duration-300 group-hover:bg-brand group-hover:text-white group-hover:rotate-[-4deg]">
        <ServiceIcon name={s.icon} className="h-7 w-7" />
      </span>
      <h3 className="mt-5 text-lg font-bold leading-snug transition-colors group-hover:text-brand">{pick(s, "title", locale)}</h3>
      <p className="mt-2 flex-1 text-[15px] leading-7 text-slate">{pick(s, "summary", locale)}</p>
      <span className="mt-5 inline-flex items-center gap-1 text-sm font-semibold text-brand">
        {t.common.learnMore}
        <ArrowIcon className="h-4 w-4 transition-transform group-hover:translate-x-1 rtl:group-hover:-translate-x-1" />
      </span>
    </Link>
  );
}

export function ResourceCard({
  r,
  locale,
  t,
}: {
  r: { slug: string; type: string; category: string; titleAr: string; titleEn: string; excerptAr: string; excerptEn: string; coverImage: string | null; readMinutes: number | null; publishedAt: Date };
  locale: Locale;
  t: Dictionary;
}) {
  const TypeIcon = r.type === "VIDEO" ? PlayIcon : r.type === "TEMPLATE" ? FileIcon : null;
  return (
    <Link href={`/${locale}/knowledge/${r.slug}`} className="card card-hover group flex h-full flex-col overflow-hidden">
      <div className="relative aspect-[16/9] overflow-hidden bg-gradient-to-br from-sky-50 to-sky">
        {r.coverImage ? (
          <Image src={r.coverImage} alt="" fill sizes="(min-width:1024px) 33vw, 100vw" className="object-cover transition-transform duration-700 group-hover:scale-105" />
        ) : (
          <div className="grid-bg-dark absolute inset-0">
            <svg viewBox="0 0 120 60" className="absolute inset-0 h-full w-full p-8 text-brand/40 transition-transform duration-700 group-hover:scale-105" aria-hidden="true">
              <path d="M5 50 L30 34 L50 40 L75 18 L95 24 L115 8" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
              <circle cx="115" cy="8" r="3.5" fill="#C5A15A" />
            </svg>
          </div>
        )}
        <span className="chip absolute start-4 top-4 bg-white/95 text-navy shadow-sm">
          {TypeIcon && <TypeIcon className="h-3.5 w-3.5" />}
          {(t.categories.resourceType as Record<string, string>)[r.type]}
        </span>
      </div>
      <div className="flex flex-1 flex-col p-6">
        <p className="text-xs font-semibold uppercase tracking-wider text-gold-600">{(t.categories.resource as Record<string, string>)[r.category]}</p>
        <h3 className="mt-2 text-lg font-bold leading-snug transition-colors group-hover:text-brand">{pick(r, "title", locale)}</h3>
        <p className="mt-2 line-clamp-3 flex-1 text-[15px] leading-7 text-slate">{pick(r, "excerpt", locale)}</p>
        <p className="mt-4 text-xs text-slate">
          {formatDate(r.publishedAt, locale)}
          {r.readMinutes ? ` · ${r.readMinutes} ${t.common.minutesRead}` : ""}
        </p>
      </div>
    </Link>
  );
}
