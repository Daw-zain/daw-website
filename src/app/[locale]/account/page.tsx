import Link from "next/link";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { isLocale, type Locale } from "@/lib/constants";
import { getDictionary } from "@/lib/i18n";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { pageMeta } from "@/lib/seo";
import { formatDate, pick } from "@/lib/utils";
import { logout } from "@/app/actions/public";
import { ResourceCard } from "@/components/cards";
import { EmptyState, PageHero } from "@/components/ui";
import { StaticAccount } from "@/components/StaticAccount";
import { getResources } from "@/lib/queries";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  return pageMeta({ locale, path: "/account", title: getDictionary(locale).nav.account, noindex: true });
}

export default async function Account({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: l } = await params;
  const locale = l as Locale;
  const t = getDictionary(locale);

  // GitHub Pages build: no server session — the dashboard is rendered in the browser from the Supabase session.
  if (process.env.STATIC_EXPORT === "1") {
    const resources = await getResources();
    return (
      <StaticAccount
        locale={locale}
        labels={{ welcome: t.account.welcome, dashboardText: t.account.dashboardText, logout: t.nav.logout, savedList: t.knowledge.savedList, noFavorites: t.account.noFavorites, knowledge: t.nav.knowledge, exams: t.exams.navLabel }}
        resources={resources.map((r) => ({ id: r.id, node: <ResourceCard r={r} locale={locale} t={t} /> }))}
      />
    );
  }

  const user = await getCurrentUser();
  if (!user) redirect(`/${locale}/account/login?next=/${locale}/account`);
  const [favorites, registrations] = await Promise.all([
    db.favorite.findMany({ where: { userId: user.id }, include: { resource: true }, orderBy: { createdAt: "desc" } }),
    db.registration.findMany({ where: { userId: user.id }, include: { program: true, session: true }, orderBy: { createdAt: "desc" }, take: 20 }),
  ]);
  const favs = favorites.map((f) => f.resource).filter((r) => r.published);

  return (
    <>
      <PageHero title={`${t.account.welcome}${locale === "ar" ? "، " : ", "}${user.name}`} text={t.account.dashboardText}>
        <div className="mt-6 flex flex-wrap gap-3">
          {(user.role === "ADMIN" || user.role === "EDITOR") && (
            <Link href="/admin" className="btn btn-gold btn-sm">
              Admin
            </Link>
          )}
          <form action={logout}>
            <input type="hidden" name="_locale" value={locale} />
            <button className="btn btn-ghost-light btn-sm">{t.nav.logout}</button>
          </form>
        </div>
      </PageHero>
      <section className="py-14">
        <div className="container-x space-y-14">
          {registrations.length > 0 && (
            <div>
              <h2 className="text-2xl font-bold">{t.nav.programs}</h2>
              <ul className="mt-6 grid gap-3">
                {registrations.map((r) => (
                  <li key={r.id} className="card flex flex-wrap items-center justify-between gap-3 p-5">
                    <Link href={`/${locale}/programs/${r.program.slug}`} className="font-semibold text-navy hover:text-brand">
                      {pick(r.program, "title", locale)}
                    </Link>
                    <span className="text-sm text-slate">{r.session ? formatDate(r.session.startDate, locale) : t.forms.noSessionOption}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div>
            <h2 className="text-2xl font-bold">{t.knowledge.savedList}</h2>
            {favs.length === 0 ? (
              <div className="mt-6">
                <EmptyState text={t.account.noFavorites}>
                  <Link href={`/${locale}/knowledge`} className="btn btn-primary">
                    {t.nav.knowledge}
                  </Link>
                </EmptyState>
              </div>
            ) : (
              <div className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                {favs.map((r) => (
                  <ResourceCard key={r.id} r={r} locale={locale} t={t} />
                ))}
              </div>
            )}
          </div>
        </div>
      </section>
    </>
  );
}
