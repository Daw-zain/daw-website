"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { setAdminLang } from "@/app/admin/actions";
import { cn } from "@/lib/utils";
import { MenuIcon } from "@/components/Icons";

type Group = { title: string; items: { href: string; label: string; badge?: number }[] };

export function AdminNav({ groups }: { groups: Group[] }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="mx-5 mb-4 inline-flex items-center gap-2 rounded-lg border border-white/15 px-3 py-2 text-sm lg:hidden" onClick={() => setOpen(!open)} aria-expanded={open}>
        <MenuIcon className="h-5 w-5" /> Menu
      </button>
      <nav className={cn("space-y-6 px-3 pb-8", !open && "hidden lg:block")}>
        {groups.map((g) => (
          <div key={g.title || "main"}>
            {g.title && <p className="px-3 pb-2 text-[11px] font-bold uppercase tracking-wider text-white/40">{g.title}</p>}
            <ul className="space-y-0.5">
              {g.items.map((it) => {
                const active = it.href === "/admin" ? path === "/admin" : path.startsWith(it.href);
                return (
                  <li key={it.href}>
                    <Link
                      href={it.href}
                      onClick={() => setOpen(false)}
                      className={cn("flex items-center justify-between rounded-lg px-3 py-2 text-sm transition", active ? "bg-white/10 font-semibold text-white" : "text-white/70 hover:bg-white/5 hover:text-white")}
                    >
                      {it.label}
                      {!!it.badge && <span className="min-w-6 rounded-full bg-gold px-1.5 text-center text-xs font-bold text-navy">{it.badge}</span>}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
    </>
  );
}

export function LangToggle({ lang, label }: { lang: string; label: string }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <button type="button" disabled={pending} onClick={() => start(async () => { await setAdminLang(lang === "ar" ? "en" : "ar"); router.refresh(); })} className="btn btn-outline btn-sm">
      {label}
    </button>
  );
}
