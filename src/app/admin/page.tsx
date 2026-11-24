import Link from "next/link";
import { db } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { smtpConfigured } from "@/lib/mail";
import { getAdminDict, getAdminLang } from "@/lib/admin-i18n";
import { AdminShell } from "@/components/admin/AdminShell";
import { markNotificationsRead } from "./actions";
import { cn } from "@/lib/utils";

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ denied?: string }> }) {
  const sp = await searchParams;
  const lang = await getAdminLang();
  const a = getAdminDict(lang);
  const since = new Date();
  since.setMonth(since.getMonth() - 5, 1);
  since.setHours(0, 0, 0, 0);

  const [settings, newReg, newCon, newCorp, newMsg, totReg, totCon, totCorp, totMsg, subs, programsCount, upcoming, testimonials, noDuration, recentRegs, byProgram, programs, notifications] = await Promise.all([
    getSettings(),
    db.registration.count({ where: { status: "NEW" } }),
    db.consultationRequest.count({ where: { status: "NEW" } }),
    db.corporateRequest.count({ where: { status: "NEW" } }),
    db.contactMessage.count({ where: { status: "NEW" } }),
    db.registration.count(),
    db.consultationRequest.count(),
    db.corporateRequest.count(),
    db.contactMessage.count(),
    db.subscriber.count({ where: { confirmedAt: { not: null }, unsubscribedAt: null } }),
    db.program.count({ where: { published: true } }),
    db.courseSession.count({ where: { published: true, startDate: { gte: new Date() } } }),
    db.testimonial.count({ where: { published: true, consent: true } }),
    db.program.count({ where: { published: true, hours: null, durationEn: "" } }),
    db.registration.findMany({ where: { createdAt: { gte: since } }, select: { createdAt: true } }),
    db.registration.groupBy({ by: ["programId"], _count: { _all: true } }),
    db.program.findMany({ select: { id: true, titleAr: true, titleEn: true } }),
    db.notification.findMany({ orderBy: { createdAt: "desc" }, take: 8 }),
  ]);

  // registrations per month (last 6)
  const months: { label: string; count: number }[] = [];
  for (let i = 0; i < 6; i++) {
    const d = new Date(since.getFullYear(), since.getMonth() + i, 1);
    months.push({
      label: d.toLocaleDateString(lang === "ar" ? "ar-LY-u-nu-latn" : "en-GB", { month: "short" }),
      count: recentRegs.filter((r) => r.createdAt.getFullYear() === d.getFullYear() && r.createdAt.getMonth() === d.getMonth()).length,
    });
  }
  const maxM = Math.max(1, ...months.map((m) => m.count));
  const progName = (id: string) => {
    const p = programs.find((x) => x.id === id);
    return p ? (lang === "ar" ? p.titleAr : p.titleEn) : "—";
  };
  const byProg = byProgram.map((b) => ({ name: progName(b.programId), count: b._count._all })).sort((x, y) => y.count - x.count).slice(0, 8);
  const maxP = Math.max(1, ...byProg.map((b) => b.count));

  const checklist = [
    !settings.heroImage && a.setupItems.heroImage,
    !settings.contactEmail && a.setupItems.contactEmail,
    !settings.phone && a.setupItems.phone,
    !settings.whatsapp && a.setupItems.whatsapp,
    !settings.linkedin && a.setupItems.linkedin,
    !(settings.adminNotifyEmail || process.env.ADMIN_NOTIFY_EMAIL) && a.setupItems.adminNotifyEmail,
    upcoming === 0 && a.setupItems.sessions,
    noDuration > 0 && `${a.setupItems.durations} (${noDuration})`,
    testimonials === 0 && a.setupItems.testimonials,
    !settings.cvUrl && a.setupItems.cvUrl,
  ].filter(Boolean) as string[];

  const cards = [
    { href: "/admin/inbox/registrations", label: a.registrations, n: newReg, total: totReg },
    { href: "/admin/inbox/consultations", label: a.consultations, n: newCon, total: totCon },
    { href: "/admin/inbox/corporate", label: a.corporate, n: newCorp, total: totCorp },
    { href: "/admin/inbox/messages", label: a.messages, n: newMsg, total: totMsg },
  ];

  return (
    <AdminShell title={a.dashboard}>
      {sp.denied && <p className="mb-6 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-800">{a.denied}</p>}
      {!smtpConfigured() && <p className="mb-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">{a.emailOff}</p>}

      <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-slate">{a.newRequests}</h2>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((c) => (
          <Link key={c.href} href={`${c.href}?status=NEW`} className="card card-hover p-5">
            <p className="text-sm text-slate">{c.label}</p>
            <p className={cn("mt-2 text-4xl font-extrabold", c.n ? "text-brand" : "text-navy")}>{c.n}</p>
            <p className="mt-1 text-xs text-slate">
              {a.totals}: {c.total}
            </p>
          </Link>
        ))}
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        {[
          { label: a.programs, n: programsCount, href: "/admin/content/programs" },
          { label: a.sessions, n: upcoming, href: "/admin/content/sessions" },
          { label: a.subscribers, n: subs, href: "/admin/subscribers" },
        ].map((s) => (
          <Link key={s.label} href={s.href} className="card flex items-center justify-between p-5 hover:border-brand/40">
            <span className="text-sm font-semibold text-navy">{s.label}</span>
            <span className="text-2xl font-bold text-navy">{s.n}</span>
          </Link>
        ))}
      </div>

      <div className="mt-8 grid gap-6 xl:grid-cols-2">
        <section className="card p-6">
          <h2 className="font-bold">{a.regsByMonth}</h2>
          <div className="mt-6 flex h-48 items-end gap-3" role="img" aria-label={a.regsByMonth}>
            {months.map((m) => (
              <div key={m.label} className="flex flex-1 flex-col items-center gap-2">
                <span className="text-xs font-semibold text-navy">{m.count}</span>
                <div className="w-full rounded-t-lg bg-gradient-to-t from-brand to-brand-400 transition-all" style={{ height: `${(m.count / maxM) * 140 + 4}px` }} />
                <span className="text-xs text-slate">{m.label}</span>
              </div>
            ))}
          </div>
        </section>
        <section className="card p-6">
          <h2 className="font-bold">{a.regsByProgram}</h2>
          {byProg.length === 0 ? (
            <p className="mt-6 text-sm text-slate">{a.noItems}</p>
          ) : (
            <ul className="mt-5 space-y-3">
              {byProg.map((b) => (
                <li key={b.name}>
                  <div className="flex justify-between text-sm">
                    <span className="truncate text-navy">{b.name}</span>
                    <span className="font-semibold">{b.count}</span>
                  </div>
                  <div className="mt-1 h-2 rounded-full bg-sky">
                    <div className="h-2 rounded-full bg-gold" style={{ width: `${(b.count / maxP) * 100}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <div className="mt-8 grid gap-6 xl:grid-cols-2">
        <section className="card p-6">
          <h2 className="font-bold">{a.checklist}</h2>
          {checklist.length === 0 ? (
            <p className="mt-4 text-sm text-emerald-700">✓ {a.checklistDone}</p>
          ) : (
            <ul className="mt-4 space-y-2 text-sm">
              {checklist.map((c) => (
                <li key={c} className="flex gap-2">
                  <span className="text-amber-500">●</span>
                  {c}
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="card p-6">
          <div className="flex items-center justify-between">
            <h2 className="font-bold">{a.notifications}</h2>
            <form action={markNotificationsRead}>
              <button className="text-xs font-semibold text-brand hover:underline">{a.markRead}</button>
            </form>
          </div>
          {notifications.length === 0 ? (
            <p className="mt-4 text-sm text-slate">{a.noItems}</p>
          ) : (
            <ul className="mt-4 divide-y divide-line">
              {notifications.map((n) => (
                <li key={n.id} className="py-3">
                  <Link href={n.link ?? "#"} className="group block">
                    <p className={cn("text-sm group-hover:text-brand", !n.read && "font-bold")}>{n.title}</p>
                    <p className="mt-0.5 text-xs text-slate">
                      {n.createdAt.toLocaleString(lang === "ar" ? "ar-LY-u-nu-latn" : "en-GB")} · {n.emailedAt ? a.emailed : a.notEmailed}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </AdminShell>
  );
}
