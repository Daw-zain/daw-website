import Link from "next/link";
import type { ReactNode } from "react";
import { Reveal } from "./motion";
import { ArrowIcon, FacebookIcon, LinkedInIcon, WhatsAppIcon } from "./Icons";
import { cn, whatsappLink } from "@/lib/utils";

export function SectionHeading({ eyebrow, title, text, center = false, light = false }: { eyebrow?: string; title: string; text?: string; center?: boolean; light?: boolean }) {
  return (
    <Reveal className={cn("max-w-3xl", center && "mx-auto text-center")}>
      {eyebrow && <p className={cn("eyebrow", center && "justify-center", light && "text-gold")}>{eyebrow}</p>}
      <h2 className={cn("h-section mt-3", light && "text-white")}>{title}</h2>
      {text && <p className={cn("lead mt-4", light && "text-white/70")}>{text}</p>}
    </Reveal>
  );
}

export function PageHero({ title, text, eyebrow, crumbs, children }: { title: string; text?: string; eyebrow?: string; crumbs?: { href?: string; label: string }[]; children?: ReactNode }) {
  return (
    <section className="relative overflow-hidden bg-navy text-white">
      <div className="grid-bg pointer-events-none absolute inset-0" aria-hidden="true" />
      <div className="pointer-events-none absolute -end-24 -top-24 h-96 w-96 rounded-full bg-brand/40 blur-3xl animate-float-slow" aria-hidden="true" />
      <div className="pointer-events-none absolute -bottom-32 start-1/3 h-72 w-72 rounded-full bg-gold/15 blur-3xl animate-float" aria-hidden="true" />
      <div className="container-x relative py-16 sm:py-20">
        {crumbs && <Breadcrumbs items={crumbs} />}
        <Reveal>
          {eyebrow && <p className="eyebrow mt-6 text-gold">{eyebrow}</p>}
          <h1 className="mt-4 max-w-4xl text-4xl font-bold leading-tight text-white sm:text-5xl">{title}</h1>
          {text && <p className="mt-5 max-w-3xl text-lg leading-relaxed text-white/75">{text}</p>}
        </Reveal>
        {children}
      </div>
    </section>
  );
}

export function Breadcrumbs({ items }: { items: { href?: string; label: string }[] }) {
  return (
    <nav aria-label="Breadcrumb">
      <ol className="flex flex-wrap items-center gap-2 text-sm text-white/60">
        {items.map((c, i) => (
          <li key={i} className="flex items-center gap-2">
            {i > 0 && <span aria-hidden="true">/</span>}
            {c.href ? (
              <Link href={c.href} className="transition hover:text-gold">
                {c.label}
              </Link>
            ) : (
              <span aria-current="page" className="text-white/90">
                {c.label}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

export function ArrowLink({ href, children, className }: { href: string; children: ReactNode; className?: string }) {
  return (
    <Link href={href} className={cn("group inline-flex items-center gap-1.5 font-semibold text-brand transition hover:text-brand-600", className)}>
      {children}
      <ArrowIcon className="h-4 w-4 transition-transform group-hover:translate-x-1 rtl:group-hover:-translate-x-1" />
    </Link>
  );
}

const statusStyles: Record<string, string> = {
  OPEN: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200",
  COMING_SOON: "bg-sky text-brand-600 ring-1 ring-brand/20",
  ON_REQUEST: "bg-amber-50 text-amber-800 ring-1 ring-amber-200",
  CLOSED: "bg-mist text-slate ring-1 ring-line",
  FULL: "bg-rose-50 text-rose-700 ring-1 ring-rose-200",
};

export function StatusChip({ status, label }: { status: string; label: string }) {
  return (
    <span className={cn("chip", statusStyles[status] ?? statusStyles.CLOSED)}>
      <span className={cn("h-1.5 w-1.5 rounded-full", status === "OPEN" ? "bg-emerald-500 animate-pulse" : "bg-current opacity-60")} />
      {label}
    </span>
  );
}

export function ShareButtons({ url, title, label }: { url: string; title: string; label: string }) {
  const u = encodeURIComponent(url);
  const items = [
    { name: "LinkedIn", href: `https://www.linkedin.com/sharing/share-offsite/?url=${u}`, Icon: LinkedInIcon },
    { name: "Facebook", href: `https://www.facebook.com/sharer/sharer.php?u=${u}`, Icon: FacebookIcon },
    { name: "WhatsApp", href: `https://wa.me/?text=${encodeURIComponent(`${title} ${url}`)}`, Icon: WhatsAppIcon },
  ];
  return (
    <div className="flex items-center gap-2">
      <span className="text-sm font-semibold text-slate">{label}:</span>
      {items.map(({ name, href, Icon }) => (
        <a key={name} href={href} target="_blank" rel="noopener noreferrer" aria-label={`${label} – ${name}`} className="grid h-9 w-9 place-items-center rounded-lg border border-line text-navy transition hover:-translate-y-0.5 hover:border-brand hover:text-brand">
          <Icon className="h-4 w-4" />
        </a>
      ))}
    </div>
  );
}

export function WhatsAppFloat({ number, text, label }: { number: string; text: string; label: string }) {
  const href = whatsappLink(number, text);
  if (!href) return null;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={label}
      className="no-print group fixed bottom-5 end-5 z-40 flex items-center gap-2 rounded-full bg-[#25D366] p-3.5 text-white shadow-[0_12px_30px_-8px_rgb(37_211_102/0.7)] transition hover:-translate-y-1 hover:shadow-[0_18px_36px_-10px_rgb(37_211_102/0.8)]"
    >
      <span className="absolute inset-0 animate-ping rounded-full bg-[#25D366] opacity-20 motion-reduce:hidden" aria-hidden="true" />
      <WhatsAppIcon className="relative h-7 w-7" />
      <span className="relative hidden max-w-0 overflow-hidden whitespace-nowrap text-sm font-semibold transition-all duration-300 group-hover:max-w-48 sm:inline">{label}</span>
    </a>
  );
}

export function WhatsAppInquiry({ number, text, label, className }: { number: string; text: string; label: string; className?: string }) {
  const href = whatsappLink(number, text);
  if (!href) return null;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={cn("btn border border-[#25D366]/40 bg-[#25D366]/10 text-[#128C4B] hover:bg-[#25D366]/20 hover:-translate-y-0.5", className)}>
      <WhatsAppIcon className="h-5 w-5" />
      {label}
    </a>
  );
}

export function JsonLd({ data }: { data: object | object[] }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, "\\u003c") }} />;
}

export function EmptyState({ text, children }: { text: string; children?: ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-line bg-mist/60 px-6 py-12 text-center">
      <p className="mx-auto max-w-lg text-slate">{text}</p>
      {children && <div className="mt-6 flex flex-wrap justify-center gap-3">{children}</div>}
    </div>
  );
}
