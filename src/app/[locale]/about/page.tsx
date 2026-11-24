import Link from "next/link";
import Image from "next/image";
import type { Metadata } from "next";
import { isLocale, type Locale } from "@/lib/constants";
import { getDictionary } from "@/lib/i18n";
import { getSettings } from "@/lib/settings";
import { getCredentials } from "@/lib/queries";
import { breadcrumbJsonLd, pageMeta } from "@/lib/seo";
import { pick } from "@/lib/utils";
import { PageHero, JsonLd, SectionHeading } from "@/components/ui";
import { Reveal } from "@/components/motion";
import { AwardIcon, CapIcon, CheckIcon, DownloadIcon } from "@/components/Icons";

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
  const [settings, credentials] = await Promise.all([getSettings(), getCredentials()]);
  const L = (p: string) => `/${locale}${p}`;
  const portrait = settings.aboutImage || settings.heroImage;
  const cvHref = settings.cvUrl || L("/cv");

  return (
    <>
      <PageHero title={t.about.title} text={t.about.intro} crumbs={[{ href: L(""), label: t.common.breadcrumbHome }, { label: t.nav.about }]} />
      <JsonLd data={breadcrumbJsonLd([{ name: t.common.breadcrumbHome, path: L("") }, { name: t.nav.about, path: L("/about") }])} />

      {/* Bio */}
      <section className="py-20">
        <div className="container-x grid gap-12 lg:grid-cols-[1fr_1.4fr]">
          <Reveal>
            <div className="relative mx-auto aspect-[4/5] w-full max-w-sm overflow-hidden rounded-3xl bg-gradient-to-br from-navy-700 to-brand-600 shadow-lift lg:sticky lg:top-28">
              {portrait ? (
                <Image src={portrait} alt={t.home.portraitAlt} fill sizes="(min-width:1024px) 380px, 90vw" className="object-cover object-[50%_18%]" />
              ) : (
                <div className="grid h-full place-items-center text-center" role="img" aria-label={t.home.portraitAlt}>
                  <div className="grid-bg absolute inset-0" />
                  <div className="relative" dir="ltr">
                    <span className="text-6xl font-extrabold text-white">
                      D<span className="text-gold">Z</span>
                    </span>
                    <p className="mt-3 font-semibold text-white/80">Daw Zainelabideen</p>
                  </div>
                </div>
              )}
            </div>
          </Reveal>
          <div>
            <SectionHeading eyebrow={t.about.bioTitle} title={locale === "ar" ? "ضو زين العابدين" : "Daw Zainelabideen"} />
            <div className="prose-site mt-6">
              {t.about.bio.map((p, i) => (
                <Reveal key={i} delay={i * 0.05}>
                  <p>{p}</p>
                </Reveal>
              ))}
            </div>
            <Reveal className="mt-8 flex flex-wrap gap-3">
              <Link href={cvHref} className="btn btn-primary" {...(settings.cvUrl ? { target: "_blank" } : {})}>
                <DownloadIcon className="h-5 w-5" />
                {t.cta.cv}
              </Link>
              <Link href={L("/contact")} className="btn btn-outline">
                {t.cta.contact}
              </Link>
            </Reveal>
          </div>
        </div>
      </section>

      {/* Academic + certifications */}
      <section className="bg-mist py-20">
        <div className="container-x grid gap-10 lg:grid-cols-2">
          {(["ACADEMIC", "PROFESSIONAL"] as const).map((kind) => (
            <Reveal key={kind} className="card p-8">
              <h2 className="flex items-center gap-3 text-2xl font-bold">
                {kind === "ACADEMIC" ? <CapIcon className="h-7 w-7 text-brand" /> : <AwardIcon className="h-7 w-7 text-brand" />}
                {kind === "ACADEMIC" ? t.about.academicTitle : t.about.certsTitle}
              </h2>
              <ul className="mt-6 space-y-5">
                {credentials
                  .filter((c) => c.kind === kind)
                  .map((c) => (
                    <li key={c.id} className="flex gap-4">
                      {c.image ? (
                        <Image src={c.image} alt="" width={56} height={56} className="h-14 w-14 shrink-0 rounded-full object-cover" />
                      ) : (
                        <span className="mt-1 grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-navy text-xs font-bold text-gold" dir="ltr">
                          {c.code?.replace("PMI-", "")}
                        </span>
                      )}
                      <div>
                        <p className="font-semibold text-navy">{pick(c, "title", locale)}</p>
                        <p className="text-sm text-slate">
                          {[pick(c, "issuer", locale), c.year].filter(Boolean).join(" · ")}
                        </p>
                      </div>
                    </li>
                  ))}
              </ul>
              {kind === "PROFESSIONAL" && (
                <Link href={L("/credentials")} className="mt-6 inline-block text-sm font-semibold text-brand hover:underline">
                  {t.credentials.verify} →
                </Link>
              )}
            </Reveal>
          ))}
        </div>
      </section>

      {/* Experience timeline */}
      <section className="py-20">
        <div className="container-x">
          <SectionHeading eyebrow={t.about.experienceTitle} title={t.about.experienceTitle} />
          <ol className="relative mt-12 grid gap-6 md:grid-cols-2 lg:grid-cols-4">
            {t.about.experience.map((e, i) => (
              <Reveal key={i} as="li" delay={i * 0.08} className="card card-hover relative p-6">
                <span className="chip bg-sky text-brand-600" dir="auto">
                  {e.period}
                </span>
                <h3 className="mt-4 text-lg font-bold">{e.title}</h3>
                <p className="mt-2 text-[15px] leading-7 text-slate">{e.text}</p>
                <span className="absolute inset-x-6 top-0 h-1 rounded-b-full bg-gradient-to-r from-brand to-gold" aria-hidden="true" />
              </Reveal>
            ))}
          </ol>
        </div>
      </section>

      {/* Philosophy + method */}
      <section className="relative overflow-hidden bg-navy py-20 text-white">
        <div className="grid-bg absolute inset-0" aria-hidden="true" />
        <div className="container-x relative grid gap-14 lg:grid-cols-2">
          <div>
            <SectionHeading eyebrow={t.about.philosophyTitle} title={t.about.philosophyTitle} light />
            <ul className="mt-8 space-y-5">
              {t.about.philosophy.map((p, i) => (
                <Reveal key={i} as="li" delay={i * 0.06} className="flex gap-4">
                  <span className="mt-1 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-gold text-navy">
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

      {/* Domains + CV */}
      <section className="py-20">
        <div className="container-x grid gap-10 lg:grid-cols-[1.5fr_1fr]">
          <div>
            <SectionHeading eyebrow={t.about.domainsTitle} title={t.about.domainsTitle} />
            <ul className="mt-8 flex flex-wrap gap-3">
              {t.about.domains.map((d, i) => (
                <Reveal key={d} as="li" delay={i * 0.03}>
                  <span className="inline-flex rounded-full border border-line bg-white px-4 py-2 text-[15px] font-medium text-navy shadow-sm transition hover:-translate-y-0.5 hover:border-brand hover:text-brand">{d}</span>
                </Reveal>
              ))}
            </ul>
          </div>
          <Reveal className="card flex flex-col justify-center bg-gradient-to-br from-sky-50 to-white p-8">
            <h2 className="text-2xl font-bold">{t.about.cvTitle}</h2>
            <p className="mt-2 text-slate">{t.about.cvText}</p>
            <Link href={cvHref} className="btn btn-primary mt-6 self-start" {...(settings.cvUrl ? { target: "_blank" } : {})}>
              <DownloadIcon className="h-5 w-5" />
              {t.cta.cv}
            </Link>
          </Reveal>
        </div>
      </section>
    </>
  );
}
