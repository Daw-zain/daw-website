import Image from "next/image";
import type { Metadata } from "next";
import { isLocale, type Locale } from "@/lib/constants";
import { getDictionary } from "@/lib/i18n";
import { getSettings } from "@/lib/settings";
import { breadcrumbJsonLd, pageMeta } from "@/lib/seo";
import { BRAND } from "@/lib/brand";
import { PageHero, JsonLd, SectionHeading } from "@/components/ui";
import { Reveal } from "@/components/motion";
import { CheckIcon } from "@/components/Icons";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const t = getDictionary(locale);
  return pageMeta({ locale, path: "/about", title: t.about.title, description: t.about.intro });
}

export default async function About({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: l } = await params;
  const locale = l as Locale;
  const t = getDictionary(locale);
  const settings = await getSettings();
  const L = (p: string) => `/${locale}${p}`;
  const ar = locale === "ar";

  return (
    <>
      <PageHero title={t.about.title} text={t.about.intro} crumbs={[{ href: L(""), label: t.common.breadcrumbHome }, { label: t.nav.about }]} />
      <JsonLd data={breadcrumbJsonLd([{ name: t.common.breadcrumbHome, path: L("") }, { name: t.nav.about, path: L("/about") }])} />

      {/* Who we are */}
      <section className="py-20">
        <div className="container-x grid items-start gap-12 lg:grid-cols-[1.4fr_1fr]">
          <div>
            <SectionHeading eyebrow={ar ? BRAND.nameAr : BRAND.nameEn} title={t.about.bioTitle} />
            <div className="mt-6 space-y-5 text-[17px] leading-8 text-ink/90">
              {t.about.bio.map((p, i) => (
                <Reveal key={i} delay={i * 0.05}>
                  <p>{p}</p>
                </Reveal>
              ))}
            </div>
          </div>
          <div className="space-y-6">
            {settings.atpBadge && (
              <Reveal className="card flex items-center gap-5 p-6">
                <Image src={settings.atpBadge} alt={t.home.atpTitle} width={96} height={96} className="h-20 w-20 shrink-0 object-contain" />
                <div>
                  <h2 className="text-lg font-bold">{t.home.atpTitle}</h2>
                  <p className="mt-1 text-sm leading-6 text-slate">{t.home.atpText}</p>
                </div>
              </Reveal>
            )}
            {/* The company itself is presented on its own site — link there instead of repeating it here. */}
            <Reveal className="relative overflow-hidden rounded-2xl bg-navy p-7 text-white shadow-xl">
              <div className="pointer-events-none absolute -end-16 -top-16 h-48 w-48 rounded-full bg-gold/25 blur-3xl" aria-hidden="true" />
              <Image src={BRAND.logoWhite} alt={ar ? BRAND.legalAr : BRAND.legalEn} width={480} height={337} className="relative h-12 w-auto" />
              <h2 className="relative mt-5 text-xl font-bold text-white">{t.about.companyTitle}</h2>
              <p className="relative mt-2 leading-7 text-white/75">{t.about.companyText}</p>
              <a href={BRAND.companyUrl} target="_blank" rel="noopener" className="btn btn-gold relative mt-5">
                {t.about.companyLink} ↗
              </a>
            </Reveal>
          </div>
        </div>
      </section>

      {/* Approach + method */}
      <section className="relative overflow-hidden bg-navy py-20 text-white">
        <div className="grid-bg absolute inset-0" aria-hidden="true" />
        <div className="container-x relative grid gap-14 lg:grid-cols-2">
          <div>
            <SectionHeading eyebrow={t.about.philosophyTitle} title={t.about.philosophyTitle} light />
            <ul className="mt-8 space-y-5">
              {t.about.philosophy.map((p, i) => (
                <Reveal key={i} as="li" delay={i * 0.06} className="flex gap-4">
                  <span className="mt-1 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-gold text-white">
                    <CheckIcon className="h-4 w-4" />
                  </span>
                  <div>
                    <h3 className="font-bold text-white">{p.title}</h3>
                    <p className="mt-1 leading-7 text-white/70">{p.text}</p>
                  </div>
                </Reveal>
              ))}
            </ul>
          </div>
          <div>
            <SectionHeading eyebrow={t.about.methodTitle} title={t.about.methodTitle} light />
            <ol className="mt-8 grid gap-4 sm:grid-cols-2">
              {t.about.method.map((m, i) => (
                <Reveal key={i} as="li" delay={i * 0.08} className="rounded-2xl border border-white/10 bg-white/5 p-6">
                  <span className="text-3xl font-extrabold text-gold" dir="ltr">
                    0{i + 1}
                  </span>
                  <h3 className="mt-2 text-lg font-bold text-white">{m.title}</h3>
                  <p className="mt-1 text-white/70">{m.text}</p>
                </Reveal>
              ))}
            </ol>
          </div>
        </div>
      </section>

      {/* Areas of expertise */}
      <section className="py-20">
        <div className="container-x">
          <SectionHeading eyebrow={t.about.domainsTitle} title={t.about.domainsTitle} />
          <ul className="mt-8 flex flex-wrap gap-3">
            {t.about.domains.map((d, i) => (
              <Reveal key={d} as="li" delay={i * 0.03}>
                <span className="inline-flex rounded-full border border-line bg-white px-4 py-2 text-[15px] font-medium text-navy shadow-sm transition hover:-translate-y-0.5 hover:border-brand hover:text-brand">{d}</span>
              </Reveal>
            ))}
          </ul>
        </div>
      </section>
    </>
  );
}
