"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { Dictionary } from "@/dictionaries/en";
import type { Locale } from "@/lib/constants";
import { Logo } from "./Logo";
import { CloseIcon, GlobeIcon, MenuIcon, SearchIcon } from "./Icons";
import { cn } from "@/lib/utils";

type NavItem = { href: string; label: string };

export function Header({ locale, t, signedIn }: { locale: Locale; t: Pick<Dictionary, "nav" | "meta">; signedIn: boolean }) {
  const pathname = usePathname() || `/${locale}`;
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const L = (p: string) => `/${locale}${p}`;
  const primary: NavItem[] = [
    { href: L(""), label: t.nav.home },
    { href: L("/about"), label: t.nav.about },
    { href: L("/programs"), label: t.nav.programs },
    { href: L("/consulting"), label: t.nav.consulting },
    { href: L("/corporate"), label: t.nav.corporate },
    { href: L("/knowledge"), label: t.nav.knowledge },
    { href: L("/calendar"), label: t.nav.calendar },
    { href: L("/contact"), label: t.nav.contact },
  ];
  const secondary: NavItem[] = [];

  const isActive = (h: string) => (h === L("") ? pathname === h : pathname === h || pathname.startsWith(h + "/"));

  // Same page in the other language
  const other: Locale = locale === "ar" ? "en" : "ar";
  const switchHref = pathname.replace(/^\/(ar|en)(?=\/|$)/, `/${other}`);

  return (
    <header
      className={cn(
        "no-print sticky top-0 z-50 transition-all duration-300",
        scrolled ? "bg-navy-900/95 shadow-[0_10px_30px_-18px_rgb(0_0_0/0.6)] backdrop-blur-lg" : "bg-navy-900/90 backdrop-blur",
      )}
    >
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:start-4 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-navy focus:px-4 focus:py-2 focus:text-white">
        {t.nav.skip}
      </a>
      <div className={cn("container-x flex items-center justify-between gap-2 transition-all max-[380px]:px-3 sm:gap-4", scrolled ? "h-16" : "h-20")}>
        <div className="flex min-w-0 shrink items-center gap-3 lg:gap-4">
          <Link href={L("")} aria-label={t.meta.siteName} className="min-w-0 shrink">
            <Logo locale={locale} light />
          </Link>
        </div>

        <nav aria-label="Main" className="hidden xl:block">
          <ul className="flex items-center gap-6">
            {primary.slice(1).map((n) => (
              <li key={n.href}>
                <Link href={n.href} className="nav-link" aria-current={isActive(n.href) ? "page" : undefined}>
                  {n.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <div className="flex shrink-0 items-center gap-1 sm:gap-2">
          <Link href={L("/search")} className="hidden rounded-lg p-2.5 text-white/75 transition hover:bg-white/10 hover:text-white sm:inline-flex" aria-label={t.nav.search}>
            <SearchIcon className="h-5 w-5" />
          </Link>
          <Link
            href={switchHref}
            hrefLang={other}
            lang={other}
            aria-label={t.nav.switchLabel}
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/20 px-2.5 py-2 text-sm font-semibold text-white transition hover:border-white/50 sm:px-3"
          >
            <GlobeIcon className="h-4 w-4 max-[380px]:hidden" />
            <span>{other.toUpperCase()}</span>
          </Link>
          <Link href={L("/register")} className="btn btn-gold btn-sm hidden sm:inline-flex">
            {t.nav.enroll}
          </Link>
          <button
            type="button"
            className="inline-flex rounded-lg p-2.5 text-white transition hover:bg-white/10 xl:hidden"
            aria-expanded={open}
            aria-controls="mobile-menu"
            aria-label={t.nav.menu}
            onClick={() => setOpen(true)}
          >
            <MenuIcon className="h-6 w-6" />
          </button>
        </div>
      </div>

      <AnimatePresence>
        {open && (
          <>
            <motion.div
              className="fixed inset-0 z-50 bg-navy/40 backdrop-blur-sm xl:hidden"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setOpen(false)}
            />
            <motion.div
              id="mobile-menu"
              role="dialog"
              aria-modal="true"
              aria-label={t.nav.menu}
              className="fixed inset-y-0 end-0 z-50 flex w-[86%] max-w-sm flex-col bg-white shadow-2xl xl:hidden"
              initial={{ x: locale === "ar" ? "-100%" : "100%" }}
              animate={{ x: 0 }}
              exit={{ x: locale === "ar" ? "-100%" : "100%" }}
              transition={{ type: "spring", damping: 30, stiffness: 300 }}
            >
              <div className="flex h-20 items-center justify-between border-b border-line px-5">
                <Logo locale={locale} />
                <button type="button" onClick={() => setOpen(false)} className="rounded-lg p-2 hover:bg-mist" aria-label={t.nav.close}>
                  <CloseIcon className="h-6 w-6" />
                </button>
              </div>
              <nav className="flex-1 overflow-y-auto px-3 py-4" aria-label="Mobile">
                <ul className="space-y-1">
                  {[...primary, ...secondary, { href: L("/search"), label: t.nav.search }, { href: L("/account"), label: signedIn ? t.nav.account : t.nav.login }].map((n, i) => (
                    <motion.li key={n.href} initial={{ opacity: 0, x: locale === "ar" ? -16 : 16 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.03 * i }}>
                      <Link
                        href={n.href}
                        aria-current={isActive(n.href) ? "page" : undefined}
                        className={cn(
                          "block rounded-xl px-4 py-3 text-[16px] font-medium transition",
                          isActive(n.href) ? "bg-sky-50 text-brand" : "text-navy hover:bg-mist",
                        )}
                      >
                        {n.label}
                      </Link>
                    </motion.li>
                  ))}
                </ul>
              </nav>
              <div className="border-t border-line p-5">
                <Link href={L("/register")} className="btn btn-primary w-full">
                  {t.nav.enroll}
                </Link>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </header>
  );
}
