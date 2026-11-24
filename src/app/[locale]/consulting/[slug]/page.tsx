import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isLocale, type Locale } from "@/lib/constants";
import { getDictionary } from "@/lib/i18n";
import { getServices } from "@/lib/queries";
import { breadcrumbJsonLd, pageMeta } from "@/lib/seo";
import { lines, pick, siteUrl } from "@/lib/utils";
import { PageHero, JsonLd, ShareButtons } from "@/components/ui";
import { Reveal } from "@/components/motion";
import { ConsultationForm } from "@/components/forms/ConsultationForm";
import { CheckIcon, ServiceIcon } from "@/components/Icons";

type Props = { params: Promise<{ locale: string; slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, slug } = await params;
  if (!isLocale(locale)) return {};
  const s = (await getServices()).find((x) => x.slug === slug);
  if (!s) return {};
  return pageMeta({ locale, path: `/consulting/${slug}`, title: pick(s, "title", locale), description: pick(s, "summary", locale) });
}

export default async function ServicePage({ params }: Props) {
  const { locale: l, slug } = await params;
  const locale = l as Locale;
  const t = getDictionary(locale);
  const services = await getServices();
  const s = services.find((x) => x.slug === slug);
  if (!s) notFound();
  const L = (p: string) => `/${locale}${p}`;
  const title = pick(s, "title", locale);
  const deliverables = lines(pick(s, "deliverables", locale));

  return (
    <>
      <PageHero
        title={title}
        text={pick(s, "summary", locale)}
        crumbs={[{ href: L(""), label: t.common.breadcrumbHome }, { href: L("/consulting"), label: t.nav.consulting }, { label: title }]}
      />
      <JsonLd
        data={[
          { "@context": "https://schema.org", "@type": "Service", name: title, description: pick(s, "summary", locale), provider: { "@type": "Person", name: "Daw Zainelabideen" }, url: siteUrl(L(`/consulting/${slug}`)) },
          breadcrumbJsonLd([{ name: t.common.breadcrumbHome, path: L("") }, { name: t.nav.consulting, path: L("/consulting") }, { name: title, path: L(`/consulting/${slug}`) }]),
        ]}
      />
      <section className="py-16">
        <div className="container-x grid gap-12 lg:grid-cols-[1.2fr_1fr]">
          <div>
            <Reveal className="flex items-start gap-5">
              <span className="grid h-16 w-16 shrink-0 place-items-center rounded-2xl bg-navy text-gold">
                <ServiceIcon name={s.icon} className="h-8 w-8" />
              </span>
              <div className="prose-site">
                {pick(s, "description", locale)
                  .split(/\n{2,}/)
                  .map((p, i) => (
                    <p key={i} className="first:mt-0">
                      {p}
                    </p>
                  ))}
              </div>
            </Reveal>
            {deliverables.length > 0 && (
              <Reveal className="card mt-10 p-7">
                <h2 className="text-xl font-bold">{t.consulting.deliverables}</h2>
                <ul className="mt-5 grid gap-3 sm:grid-cols-2">
                  {deliverables.map((d) => (
                    <li key={d} className="flex items-start gap-3 rounded-xl bg-mist p-4">
                      <CheckIcon className="mt-0.5 h-5 w-5 shrink-0 text-brand" />
                      <span className="font-medium text-navy">{d}</span>
                    </li>
                  ))}
                </ul>
              </Reveal>
            )}
            <div className="mt-10">
              <h2 className="text-xl font-bold">{t.consulting.process}</h2>
              <ol className="mt-5 grid gap-4 sm:grid-cols-2">
                {t.consulting.steps.map((st, i) => (
                  <li key={i} className="flex gap-4">
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-gold font-bold text-navy" dir="ltr">
                      {i + 1}
                    </span>
                    <div>
                      <p className="font-semibold text-navy">{st.title}</p>
                      <p className="text-sm text-slate">{st.text}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
            <div className="mt-10 flex flex-wrap items-center justify-between gap-4">
              <ShareButtons url={siteUrl(L(`/consulting/${slug}`))} title={title} label={t.common.share} />
              <Link href={L("/consulting")} className="text-sm font-semibold text-brand hover:underline">
                {t.common.back}
              </Link>
            </div>
          </div>
          <Reveal className="card h-fit p-8 lg:sticky lg:top-28">
            <h2 className="text-2xl font-bold">{t.consulting.requestTitle}</h2>
            <div className="mt-6">
              <ConsultationForm
                locale={locale}
                t={t.forms}
                services={services.map((x) => ({ id: x.id, title: pick(x, "title", locale) }))}
                methods={t.categories.contactMethod}
                defaultService={s.id}
              />
            </div>
          </Reveal>
        </div>
      </section>
    </>
  );
}
