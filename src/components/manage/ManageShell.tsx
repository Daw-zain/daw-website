"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { can, isPlatformAdmin, useExamSession, type ExamMe } from "@/lib/exams/client";
import { supabase } from "@/lib/static/supabase";
import { withBase } from "@/lib/env-public";
import { cn } from "@/lib/utils";
import { Notice, Spinner, type ExamLabels } from "@/components/exams/ExamShell";
import { staffLabel } from "@/lib/exams/manage";

export type ManageSection = "home" | "trainees" | "trainers" | "users" | "roles" | "audit" | "settings";

const ICONS: Record<ManageSection | "exams" | "site", string> = {
  home: "M3 11l9-8 9 8M5 10v10h5v-6h4v6h5V10",
  trainees: "M12 4 2 9l10 5 10-5-10-5zM6 11.5V17c0 1.5 3 3 6 3s6-1.5 6-3v-5.500M22 9v6",
  trainers: "M4 5h16v10H4zM12 15v5M8 20h8M8 9h8",
  users: "M16 19c0-2.8-2.7-5-6-5s-6 2.2-6 5M10 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM17 4.5a4 4 0 0 1 0 7M20 19c0-2-1.2-3.700-3-4.500",
  roles: "M12 3l7 3v5c0 4.5-3 8.3-7 10-4-1.7-7-5.500-7-10V6l7-3zM9 12l2 2 4-4",
  audit: "M7 4h10a2 2 0 0 1 2 2v14H5V6a2 2 0 0 1 2-2zM8 9h8M8 13h8M8 17h5",
  settings: "M4 7h10M18 7h2M4 17h2M10 17h10M16 4.5v5M8 14.5v5",
  exams: "M9 5h10v15H5V9l4-4zM9 5v4H5M9 14l2 2 4-4",
  site: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21c0-4 3.6-7 8-7s8 3 8 7",
};

const Icon = ({ name }: { name: keyof typeof ICONS }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5 shrink-0" aria-hidden="true">
    <path d={ICONS[name]} />
  </svg>
);

/** which sections a member may open (the database enforces the same rules) */
export function allowed(me: ExamMe, section: ManageSection): boolean {
  if (section === "home") return isPlatformAdmin(me);
  if (section === "trainees" || section === "trainers" || section === "users" || section === "roles") return can(me, "users", "read");
  if (section === "audit") return can(me, "audit", "read");
  return can(me, "settings", "update");
}

/**
 * Frame of the admin dashboard: top bar with the signed-in member, a side menu with the sections their
 * role allows, and the page content. Renders nothing of a section the member may not open.
 */
export function ManageShell({
  locale,
  labels,
  section,
  children,
}: {
  locale: string;
  labels: ExamLabels;
  section: ManageSection;
  children: (me: ExamMe, reload: () => void) => ReactNode;
}) {
  const m = labels.manage;
  const { state, reload } = useExamSession(locale);

  if (state.status === "loading") return <div className="py-24"><Spinner /></div>;
  if (state.status !== "ready")
    return (
      <div className="container-x py-14">
        <Notice tone={state.status === "server" ? "info" : "error"}>
          <p>{state.status === "server" ? labels.serverNotice : state.code === "account_disabled" ? labels.disabled : state.code === "account_conflict" ? labels.conflict : labels.errorGeneric}</p>
          {state.status === "error" && state.code !== "account_disabled" && (
            <button type="button" onClick={reload} className="btn btn-outline btn-sm mt-3">{labels.retry}</button>
          )}
        </Notice>
      </div>
    );

  const me = state.me;
  const nav = (["home", "trainees", "trainers", "users", "roles", "audit", "settings"] as ManageSection[]).filter((s) => allowed(me, s));
  const href = (s: ManageSection) => `/${locale}/manage${s === "home" ? "" : `/${s}`}`;
  const role = me.role === "STAFF" && me.adminRole ? staffLabel(labels.roles.STAFF, me.adminRole, locale) : labels.roles[me.role];
  const signOut = async () => {
    await supabase().auth.signOut();
    window.location.assign(withBase(`/${locale}/`));
  };
  const item = "flex items-center gap-3 whitespace-nowrap rounded-xl px-3.5 py-2.5 text-sm font-semibold transition";

  return (
    <div className="min-h-[70vh] bg-mist/50">
      <div className="border-b border-line bg-white">
        <div className="container-x flex flex-wrap items-center justify-between gap-3 py-4">
          <h1 className="text-xl font-bold text-navy sm:text-2xl">{m.title}</h1>
          <div className="flex items-center gap-3">
            <div className="text-end">
              <p className="text-sm font-semibold text-navy"><span className="sr-only">{m.signedAs} </span>{me.name || me.email}</p>
              <p className="text-xs text-slate">{role}</p>
            </div>
            <button type="button" onClick={signOut} className="btn btn-outline btn-sm">{m.signOut}</button>
          </div>
        </div>
      </div>

      <div className="container-x grid gap-6 py-6 lg:grid-cols-[15rem_minmax(0,1fr)]">
        <aside className="min-w-0">
          <nav aria-label={m.nav.menu} className="card p-2 lg:sticky lg:top-24">
            <ul className="flex gap-1 overflow-x-auto lg:block lg:space-y-1 lg:overflow-visible">
              {nav.map((s) => (
                <li key={s}>
                  <Link href={href(s)} aria-current={s === section ? "page" : undefined} className={cn(item, s === section ? "bg-brand text-white" : "text-navy hover:bg-mist")}>
                    <Icon name={s} />
                    {m.nav[s]}
                  </Link>
                </li>
              ))}
              <li className="lg:mt-3 lg:border-t lg:border-line lg:pt-3">
                <Link href={`/${locale}/exams`} className={cn(item, "text-navy hover:bg-mist")}><Icon name="exams" />{m.nav.exams}</Link>
              </li>
              <li>
                <Link href={`/${locale}/account`} className={cn(item, "text-navy hover:bg-mist")}><Icon name="site" />{m.nav.site}</Link>
              </li>
            </ul>
          </nav>
        </aside>
        <div className="min-w-0">
          {allowed(me, section) ? (
            children(me, reload)
          ) : (
            <Notice tone="error">
              <p>{isPlatformAdmin(me) ? labels.admin.errors.forbidden : m.noAccess}</p>
              <Link href={`/${locale}/exams`} className="btn btn-outline btn-sm mt-3">{labels.admin.back}</Link>
            </Notice>
          )}
        </div>
      </div>
    </div>
  );
}

export function SectionTitle({ title, text, children }: { title: string; text?: string; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h2 className="text-2xl font-bold">{title}</h2>
        {text && <p className="mt-1 max-w-3xl text-sm leading-6 text-slate">{text}</p>}
      </div>
      {children}
    </div>
  );
}
