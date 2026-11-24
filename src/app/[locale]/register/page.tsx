import type { Metadata } from "next";
import Link from "next/link";
import { isLocale, type Locale } from "@/lib/constants";
import { getDictionary } from "@/lib/i18n";
import { db } from "@/lib/db";
import { registrationOptions } from "@/lib/program-options";
import { pageMeta } from "@/lib/seo";
import { PageHero } from "@/components/ui";
import { RegistrationForm } from "@/components/forms/RegistrationForm";
import { CalendarIcon } from "@/components/Icons";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const t = getDictionary(locale);
  return pageMeta({ locale, path: "/register", title: t.cta.enroll, description: t.home.finalText });
}

export default async function Register({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ program?: string; session?: string }> }) {
  const { locale: l } = await params;
  const sp = await searchParams;
  const locale = l as Locale;
  const t = getDictionary(locale);
  const options = await registrationOptions(locale);
  const pre = sp.program ? await db.program.findFirst({ where: { slug: sp.program }, select: { id: true } }) : null;
  const L = (p: string) => `/${locale}${p}`;

  return (
    <>
      <PageHero title={t.cta.enroll} text={t.home.finalText} crumbs={[{ href: L(""), label: t.common.breadcrumbHome }, { label: t.cta.enroll }]} />
      <section className="bg-mist py-16">
        <div className="container-x grid max-w-6xl gap-8 lg:grid-cols-[1fr_320px]">
          <div className="card p-8 sm:p-10">
            <RegistrationForm
              locale={locale}
              t={t.forms}
              programs={options}
              defaultProgram={pre?.id}
              defaultSession={sp.session}
              noSessionLabel={t.forms.noSessionOption}
              exploreLabel={t.cta.explore}
            />
          </div>
          <aside className="space-y-4">
            <div className="card p-6">
              <CalendarIcon className="h-8 w-8 text-brand" />
              <h2 className="mt-3 text-lg font-bold">{t.calendar.title}</h2>
              <p className="mt-1 text-sm text-slate">{t.calendar.intro}</p>
              <Link href={L("/calendar")} className="btn btn-outline btn-sm mt-4">
                {t.common.viewAll}
              </Link>
            </div>
            <div className="card p-6">
              <h2 className="text-lg font-bold">{t.home.corporateEyebrow}</h2>
              <p className="mt-1 text-sm text-slate">{t.corporate.formText}</p>
              <Link href={L("/corporate#request")} className="btn btn-primary btn-sm mt-4">
                {t.cta.corporate}
              </Link>
            </div>
            <p className="rounded-xl bg-white p-4 text-xs leading-6 text-slate">{t.programs.pmiNote}</p>
          </aside>
        </div>
      </section>
    </>
  );
}
