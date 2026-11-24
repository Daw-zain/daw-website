import Link from "next/link";
import type { Metadata } from "next";
import { isLocale, PROGRAM_CATEGORIES, type Locale } from "@/lib/constants";
import { getDictionary } from "@/lib/i18n";
import { getPrograms } from "@/lib/queries";
import { breadcrumbJsonLd, pageMeta } from "@/lib/seo";
import { cn, pick, siteUrl } from "@/lib/utils";
import { PageHero, JsonLd } from "@/components/ui";
import { ProgramCard } from "@/components/cards";
import { Reveal } from "@/components/motion";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const t = getDictionary(locale);
  return pageMeta({ locale, path: "/programs", title: t.programs.title, description: t.programs.intro });
}

export default async function Programs({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ category?: string }> }) {
  const { locale: l } = await params;
  const { category } = await searchParams;
  const locale = l as Locale;
  const t = getDictionary(locale);
  const all = await getPrograms();
  const cats = PROGRAM_CATEGORIES.filter((c) => all.some((p) => p.category === c));
  const list = category && cats.includes(category as (typeof cats)[number]) ? all.filter((p) => p.category === category) : all;
  const L = (p: string) => `/${locale}${p}`;

  return (
    <>
      <PageHero title={t.programs.title} text={t.programs.intro} crumbs={[{ href: L(""), label: t.common.breadcrumbHome }, { label: t.nav.programs }]}>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link href={L("/register")} className="btn btn-gold">
            {t.cta.enroll}
          </Link>
          <Link href={L("/corporate#request")} className="btn btn-ghost-light">
            {t.cta.corporate}
          </Link>
        </div>
      </PageHero>
      <JsonLd
        data={[
          breadcrumbJsonLd([{ name: t.common.breadcrumbHome, path: L("") }, { name: t.nav.programs, path: L("/programs") }]),
          {
            "@context": "https://schema.org",
            "@type": "ItemList",
            itemListElement: all.map((p, i) => ({ "@type": "ListItem", position: i + 1, url: siteUrl(L(`/programs/${p.slug}`)), name: pick(p, "title", locale) })),
          },
        ]}
      />

      <section className="py-16">
        <div className="container-x">
          <nav aria-label={t.knowledge.category} className="flex flex-wrap gap-2">
            {[{ key: "", label: t.programs.filterAll }, ...cats.map((c) => ({ key: c, label: (t.categories.program as Record<string, string>)[c] }))].map((c) => {
              const active = (category ?? "") === c.key || (!cats.includes(category as (typeof cats)[number]) && c.key === "");
              return (
                <Link
                  key={c.key}
                  href={c.key ? L(`/programs?category=${c.key}`) : L("/programs")}
                  scroll={false}
                  aria-current={active ? "page" : undefined}
                  className={cn("rounded-full border px-4 py-2 text-sm font-semibold transition", active ? "border-navy bg-navy text-white" : "border-line bg-white text-navy hover:border-brand hover:text-brand")}
                >
                  {c.label}
                </Link>
              );
            })}
          </nav>
          <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {list.map((p, i) => (
              <Reveal key={p.id} delay={(i % 3) * 0.06}>
                <ProgramCard p={p} locale={locale} t={t} />
              </Reveal>
            ))}
          </div>
          <p className="mt-12 rounded-xl bg-mist px-5 py-4 text-sm leading-7 text-slate">{t.programs.pmiNote}</p>
        </div>
      </section>
    </>
  );
}
