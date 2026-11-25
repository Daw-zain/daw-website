import Link from "next/link";
import Image from "next/image";
import type { ReactNode } from "react";
import type { Dictionary } from "@/dictionaries/en";
import { LogoPortrait } from "@/components/Logo";
import { CheckIcon } from "@/components/Icons";
import { cn } from "@/lib/utils";

/**
 * Two-column layout for sign-in / sign-up / password pages:
 * brand panel (portrait, Aldaleel logo, what the account gives you) + the form card.
 */
export function AuthShell({
  locale,
  t,
  mode,
  title,
  text,
  partnerLogo,
  children,
  footer,
}: {
  locale: string;
  t: Dictionary;
  mode: "login" | "register" | "forgot" | "reset";
  title: string;
  text?: string;
  partnerLogo?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const a = t.account;
  const tabs = [
    { key: "login", label: a.signIn, href: `/${locale}/account/login` },
    { key: "register", label: a.createAccount, href: `/${locale}/account/register` },
  ];
  return (
    <section className="relative overflow-hidden bg-mist">
      <div className="pointer-events-none absolute -top-40 start-1/2 h-[480px] w-[480px] rounded-full bg-brand/10 blur-3xl" aria-hidden="true" />
      <div className="container-x relative grid min-h-[calc(100vh-5rem)] items-center gap-10 py-12 lg:grid-cols-[1fr_1.05fr] lg:py-16">
        {/* Brand panel */}
        <div className="fade-up relative hidden overflow-hidden rounded-3xl bg-navy p-10 text-white shadow-2xl lg:block xl:p-12">
          <div className="pointer-events-none absolute -end-24 -top-24 h-72 w-72 rounded-full bg-gold/20 blur-3xl" aria-hidden="true" />
          <div className="pointer-events-none absolute -bottom-28 -start-20 h-72 w-72 rounded-full bg-brand/40 blur-3xl" aria-hidden="true" />
          <div className="relative">
            <div className="flex items-center gap-4">
              <LogoPortrait className="h-16 w-16" />
              {partnerLogo && (
                <>
                  <span className="h-10 w-px bg-white/20" aria-hidden="true" />
                  <span className="rounded-xl bg-white px-3 py-2 shadow-lg">
                    <Image src={partnerLogo} alt={t.home.partnerName} width={114} height={80} className="h-9 w-auto" />
                  </span>
                </>
              )}
            </div>
            <p className="eyebrow mt-10 text-gold">{a.sideEyebrow}</p>
            <h2 className="mt-3 text-3xl font-bold leading-snug text-white xl:text-4xl">{a.sideTitle}</h2>
            <ul className="mt-8 space-y-4">
              {[a.perk1, a.perk2, a.perk3].map((p) => (
                <li key={p} className="flex gap-3 leading-7 text-white/85">
                  <span className="mt-1 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-gold/20 text-gold">
                    <CheckIcon className="h-3.5 w-3.5" />
                  </span>
                  {p}
                </li>
              ))}
            </ul>
            <p className="mt-10 flex items-center gap-2 border-t border-white/10 pt-6 text-sm text-white/60">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-4 w-4" aria-hidden="true">
                <rect x="4" y="10" width="16" height="11" rx="2" />
                <path d="M8 10V7a4 4 0 0 1 8 0v3" />
              </svg>
              {a.secure}
            </p>
          </div>
        </div>

        {/* Form card */}
        <div className="fade-up mx-auto w-full max-w-lg">
          <div className="card p-7 shadow-xl sm:p-10">
            <div className="flex items-center gap-3 lg:hidden">
              <LogoPortrait className="h-12 w-12" />
              {partnerLogo && <Image src={partnerLogo} alt={t.home.partnerName} width={114} height={80} className="h-9 w-auto" />}
            </div>
            {(mode === "login" || mode === "register") && (
              <nav className="mt-6 grid grid-cols-2 gap-1 rounded-xl border border-line bg-mist p-1 lg:mt-0" aria-label={a.sideEyebrow}>
                {tabs.map((tab) => (
                  <Link
                    key={tab.key}
                    href={tab.href}
                    aria-current={mode === tab.key ? "page" : undefined}
                    className={cn(
                      "rounded-lg px-4 py-2.5 text-center text-sm font-semibold transition",
                      mode === tab.key ? "bg-white text-navy shadow-sm" : "text-slate hover:text-navy",
                    )}
                  >
                    {tab.label}
                  </Link>
                ))}
              </nav>
            )}
            <h1 className="mt-7 text-2xl font-bold sm:text-[1.7rem]">{title}</h1>
            {text && <p className="mt-2 text-slate">{text}</p>}
            <div className="mt-7">{children}</div>
            {footer && <div className="mt-7 border-t border-line pt-5 text-sm text-slate">{footer}</div>}
          </div>
        </div>
      </div>
    </section>
  );
}
