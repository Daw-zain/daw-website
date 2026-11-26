import Link from "next/link";
import type { ReactNode } from "react";
import { requireStaff } from "@/lib/auth";
import { getAdminDict, getAdminLang } from "@/lib/admin-i18n";
import { db } from "@/lib/db";
import { adminLogout } from "@/app/admin/actions";
import { LogoMark } from "@/components/Logo";
import { AdminNav, LangToggle } from "./AdminNav";

/** Wraps every authenticated admin page: checks role, renders sidebar + header */
export async function AdminShell({ children, title, role = "EDITOR", actions }: { children: ReactNode; title: string; role?: "EDITOR" | "ADMIN"; actions?: ReactNode }) {
  const user = await requireStaff(role);
  const lang = await getAdminLang();
  const a = getAdminDict(lang);
  const [reg, con, corp, msg, notif] = await Promise.all([
    db.registration.count({ where: { status: "NEW" } }),
    db.consultationRequest.count({ where: { status: "NEW" } }),
    db.corporateRequest.count({ where: { status: "NEW" } }),
    db.contactMessage.count({ where: { status: "NEW" } }),
    db.notification.count({ where: { read: false } }),
  ]);
  const isAdmin = user.role === "ADMIN";

  const groups = [
    { title: "", items: [{ href: "/admin", label: a.dashboard, badge: notif }] },
    {
      title: a.requests,
      items: [
        { href: "/admin/inbox/registrations", label: a.registrations, badge: reg },
        { href: "/admin/inbox/consultations", label: a.consultations, badge: con },
        { href: "/admin/inbox/corporate", label: a.corporate, badge: corp },
        { href: "/admin/inbox/messages", label: a.messages, badge: msg },
      ],
    },
    {
      title: a.content,
      items: [
        { href: "/admin/content/programs", label: a.programs },
        { href: "/admin/content/sessions", label: a.sessions },
        { href: "/admin/content/services", label: a.services },
        { href: "/admin/content/resources", label: a.resources },
        { href: "/admin/content/testimonials", label: a.testimonials },
        { href: "/admin/content/credentials", label: a.credentials },
        { href: "/admin/content/stats", label: a.stats },
        { href: "/admin/content/faqs", label: a.faqs },
        { href: "/admin/media", label: a.media },
      ],
    },
    {
      title: a.system,
      items: [
        ...(isAdmin
          ? [
              { href: "/admin/settings", label: a.settings },
              { href: "/admin/subscribers", label: a.subscribers },
              { href: "/admin/content/users", label: a.users },
              { href: "/admin/audit", label: a.audit },
              { href: "/admin/backup", label: a.backup },
            ]
          : []),
        { href: "/admin/profile", label: lang === "ar" ? "حسابي وكلمة المرور" : "My account & password" },
      ],
    },
  ].filter((g) => g.items.length);

  return (
    <div className="lg:grid lg:grid-cols-[264px_1fr]">
      <aside className="border-line bg-navy-900 text-white lg:sticky lg:top-0 lg:h-screen lg:overflow-y-auto lg:border-e">
        <div className="flex items-center justify-between gap-3 px-5 py-5">
          <Link href="/admin" className="flex items-center gap-3">
            <LogoMark className="h-9 w-9" light />
            <span className="leading-tight">
              <span className="block text-sm font-bold" dir="ltr">
                Al Daleel Raqamee
              </span>
              <span className="block text-xs text-white/50">Admin</span>
            </span>
          </Link>
        </div>
        <AdminNav groups={groups} />
      </aside>
      <div className="min-w-0">
        <header className="sticky top-0 z-30 flex flex-wrap items-center justify-between gap-3 border-b border-line bg-white/90 px-5 py-3 backdrop-blur sm:px-8">
          <h1 className="text-xl font-bold text-navy">{title}</h1>
          <div className="flex flex-wrap items-center gap-2">
            {actions}
            <LangToggle lang={lang} label={a.langSwitch} />
            <Link href={`/${lang}`} target="_blank" className="btn btn-outline btn-sm">
              {a.viewSite} ↗
            </Link>
            <form action={adminLogout}>
              <button className="btn btn-sm text-slate hover:text-navy" title={user.email}>
                {a.logout}
              </button>
            </form>
          </div>
        </header>
        <main className="px-5 py-8 sm:px-8">{children}</main>
      </div>
    </div>
  );
}
