import type { Metadata } from "next";
import { isLocale, type Locale } from "@/lib/constants";
import { getDictionary } from "@/lib/i18n";
import { getFaqs, getServices } from "@/lib/queries";
import { breadcrumbJsonLd, pageMeta } from "@/lib/seo";
import { pick } from "@/lib/utils";
import { PageHero, JsonLd, SectionHeading } from "@/components/ui";
import { ServiceCard } from "@/components/cards";
import { Reveal } from "@/components/motion";
import { ConsultationForm } from "@/components/forms/ConsultationForm";
import { Accordion } from "@/components/Accordion";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const t = getDictionary(locale);
  return pageMeta({ locale, path: "/consulting", title: t.consulting.title, description: t.consulting.intro });
}

export default async function Consulting({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ service?: string }> }) {
  const { locale: l } = await params;
  const { service } = await searchParams;
  const locale = l as Locale;
  const t = getDictionary(locale);
  const [services, faqs] = await Promise.all([getServices(), getFaqs("consulting")]);
  const L = (p: string) => `/${locale}${p}`;
  const pre = services.find((s) => s.slug === service)?.id;

  return (
    <>
      <PageHero title={t.consulting.title} text={t.consulting.intro} crumbs={[{ href: L(""), label: t.common.breadcrumbHome }, { label: t.nav.consulting }]}>
        <a href="#request" className="btn btn-gold mt-8">
          {t.cta.consult}
        </a>
      </PageHero>
      <JsonLd
        data={[
          breadcrumbJsonLd([{ name: t.common.breadcrumbHome, path: L("") }, { name: t.nav.consulting, path: L("/consulting") }]),
          ...services.map((s) => ({ "@context": "https://schema.org", "@type": "Service", name: pick(s, "title", locale), description: pick(s, "summary", locale), provider: { "@type": "Person", name: "Daw Zainelabideen" }, areaServed: "Libya" })),
        ]}
      />

      <section className="py-16">
        <div className="container-x grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {services.map((s, i) => (
            <Reveal key={s.id} delay={(i % 4) * 0.06}>
              <ServiceCard s={s} locale={locale} t={t} />
            </Reveal>
          ))}
        </div>
      </section>

      <section className="bg-navy py-20 text-white">
        <div className="container-x">
          <SectionHeading eyebrow={t.consulting.process} title={t.consulting.process} light center />
          <ol className="mt-12 grid gap-6 md:grid-cols-4">
            {t.consulting.steps.map((s, i) => (
              <Reveal key={i} as="li" delay={i * 0.1} className="relative rounded-2xl border border-white/10 bg-white/5 p-6 text-center">
                <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-gold text-xl font-extrabold text-navy" dir="ltr">
                  {i + 1}
                </span>
                <h3 className="mt-4 text-lg font-bold text-white">{s.title}</h3>
                <p className="mt-2 text-white/70">{s.text}</p>
              </Reveal>
            ))}
          </ol>
        </div>
      </section>

      <section id="request" className="scroll-mt-24 py-20">
        <div className="container-x grid gap-12 lg:grid-cols-[1fr_1.3fr]">
          <div>
            <SectionHeading eyebrow={t.cta.consult} title={t.consulting.requestTitle} text={t.consulting.intro} />
            {faqs.length > 0 && (
              <div className="mt-10">
                <Accordion items={faqs.map((f) => ({ q: pick(f, "question", locale), a: pick(f, "answer", locale) }))} />
              </div>
            )}
          </div>
          <Reveal className="card p-8 sm:p-10">
            <ConsultationForm
              locale={locale}
              t={t.forms}
              services={services.map((s) => ({ id: s.id, title: pick(s, "title", locale) }))}
              methods={t.categories.contactMethod}
              defaultService={pre}
            />
          </Reveal>
        </div>
      </section>
    </>
  );
}
