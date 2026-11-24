import type { Metadata } from "next";
import { isLocale, SECTORS, type Locale } from "@/lib/constants";
import { getDictionary } from "@/lib/i18n";
import { getFaqs, getPrograms } from "@/lib/queries";
import { breadcrumbJsonLd, pageMeta } from "@/lib/seo";
import { pick } from "@/lib/utils";
import { PageHero, JsonLd, SectionHeading } from "@/components/ui";
import { Reveal } from "@/components/motion";
import { CorporateForm } from "@/components/forms/CorporateForm";
import { Accordion } from "@/components/Accordion";
import { BuildingIcon, ChartIcon, CheckIcon, CompassIcon, FileIcon, GaugeIcon, LayersIcon, ShieldIcon, SparkIcon, TargetIcon, UsersIcon, CapIcon } from "@/components/Icons";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const t = getDictionary(locale);
  return pageMeta({ locale, path: "/corporate", title: t.corporate.title, description: t.corporate.intro });
}

const sectorIcons = { government: BuildingIcon, banking: ShieldIcon, oil_gas: GaugeIcon, it: SparkIcon, private: ChartIcon, education: CapIcon, other: CompassIcon };
const whatIcons = [LayersIcon, TargetIcon, UsersIcon, FileIcon, CompassIcon, ChartIcon];

export default async function Corporate({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ program?: string }> }) {
  const { locale: l } = await params;
  const { program } = await searchParams;
  const locale = l as Locale;
  const t = getDictionary(locale);
  const [programs, faqs] = await Promise.all([getPrograms(), getFaqs("corporate")]);
  const L = (p: string) => `/${locale}${p}`;

  return (
    <>
      <PageHero title={t.corporate.title} text={t.corporate.intro} crumbs={[{ href: L(""), label: t.common.breadcrumbHome }, { label: t.nav.corporate }]}>
        <a href="#request" className="btn btn-gold mt-8">
          {t.corporate.formTitle}
        </a>
      </PageHero>
      <JsonLd data={breadcrumbJsonLd([{ name: t.common.breadcrumbHome, path: L("") }, { name: t.nav.corporate, path: L("/corporate") }])} />

      <section className="py-20">
        <div className="container-x">
          <SectionHeading eyebrow={t.corporate.sectorsTitle} title={t.corporate.sectorsTitle} />
          <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {SECTORS.filter((s) => s !== "other").map((s, i) => {
              const Icon = sectorIcons[s];
              return (
                <Reveal key={s} as="li" delay={i * 0.05} className="card card-hover group flex items-center gap-4 p-5">
                  <span className="grid h-12 w-12 place-items-center rounded-xl bg-sky text-brand transition group-hover:bg-brand group-hover:text-white">
                    <Icon className="h-6 w-6" />
                  </span>
                  <span className="text-[17px] font-semibold text-navy">{t.categories.sector[s]}</span>
                </Reveal>
              );
            })}
          </ul>
        </div>
      </section>

      <section className="bg-mist py-20">
        <div className="container-x">
          <SectionHeading eyebrow={t.corporate.whatTitle} title={t.corporate.whatTitle} center />
          <ol className="mt-12 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {t.corporate.what.map((w, i) => {
              const Icon = whatIcons[i];
              return (
                <Reveal key={i} as="li" delay={(i % 3) * 0.08} className="card card-hover relative p-7">
                  <span className="absolute end-6 top-6 text-4xl font-extrabold text-sky" dir="ltr">
                    0{i + 1}
                  </span>
                  <span className="grid h-12 w-12 place-items-center rounded-xl bg-navy text-gold">
                    <Icon className="h-6 w-6" />
                  </span>
                  <h3 className="mt-5 text-lg font-bold">{w.title}</h3>
                  <p className="mt-2 leading-7 text-slate">{w.text}</p>
                </Reveal>
              );
            })}
          </ol>
        </div>
      </section>

      <section id="request" className="scroll-mt-24 py-20">
        <div className="container-x grid gap-12 lg:grid-cols-[1fr_1.5fr]">
          <div>
            <SectionHeading eyebrow={t.cta.corporate} title={t.corporate.formTitle} text={t.corporate.formText} />
            <ul className="mt-8 space-y-3">
              {[t.status.mode.IN_PERSON, t.status.mode.ONLINE, t.status.mode.HYBRID].map((m) => (
                <li key={m} className="flex items-center gap-3 text-navy">
                  <CheckIcon className="h-5 w-5 text-gold-600" />
                  {m}
                </li>
              ))}
            </ul>
            {faqs.length > 0 && (
              <div className="mt-10">
                <Accordion items={faqs.map((f) => ({ q: pick(f, "question", locale), a: pick(f, "answer", locale) }))} />
              </div>
            )}
          </div>
          <Reveal className="card p-8 sm:p-10">
            <CorporateForm
              locale={locale}
              t={t.forms}
              sectors={t.categories.sector}
              modes={t.status.mode}
              programs={programs.map((p) => ({ value: p.titleEn, label: pick(p, "title", locale) }))}
              preselected={programs.find((p) => p.slug === program)?.titleEn}
            />
          </Reveal>
        </div>
      </section>
    </>
  );
}
