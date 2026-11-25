import Link from "next/link";
import type { Metadata } from "next";
import { isLocale, RESOURCE_CATEGORIES, RESOURCE_TYPES, type Locale } from "@/lib/constants";
import { getDictionary } from "@/lib/i18n";
import { getResources } from "@/lib/queries";
import { breadcrumbJsonLd, pageMeta } from "@/lib/seo";
import { DomFilter, FilterChips, QuerySearchBox } from "@/components/QueryFilters";
import { PageHero, JsonLd, EmptyState } from "@/components/ui";
import { ResourceCard } from "@/components/cards";
import { Reveal } from "@/components/motion";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const t = getDictionary(locale);
  return pageMeta({ locale, path: "/knowledge", title: t.knowledge.title, description: t.knowledge.intro });
}

export default async function Knowledge({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: l } = await params;
  const locale = l as Locale;
  const t = getDictionary(locale);
  const all = await getResources();
  const L = (p: string) => `/${locale}${p}`;

  return (
    <>
      <PageHero title={t.knowledge.title} text={t.knowledge.intro} crumbs={[{ href: L(""), label: t.common.breadcrumbHome }, { label: t.nav.knowledge }]}>
        <QuerySearchBox id="kq" placeholder={t.knowledge.searchPlaceholder} button={t.nav.search} />
      </PageHero>
      <JsonLd data={breadcrumbJsonLd([{ name: t.common.breadcrumbHome, path: L("") }, { name: t.nav.knowledge, path: L("/knowledge") }])} />

      <section className="py-14">
        <div className="container-x grid gap-10 lg:grid-cols-[260px_1fr]">
          <aside className="space-y-8 lg:sticky lg:top-28 lg:self-start">
            <FilterChips
              stacked
              groups={[
                { param: "type", title: t.knowledge.type, allLabel: t.common.all, options: RESOURCE_TYPES.map((x) => ({ key: x, label: t.categories.resourceType[x] })) },
                { param: "category", title: t.knowledge.category, allLabel: t.common.all, options: RESOURCE_CATEGORIES.map((x) => ({ key: x, label: t.categories.resource[x] })) },
              ]}
            />
            <Link href={L("/account")} className="btn btn-outline btn-sm">
              {t.knowledge.savedList}
            </Link>
          </aside>
          <div>
            {all.length === 0 && <EmptyState text={t.knowledge.empty} />}
            <div id="kh-noresults" hidden>
              <EmptyState text={t.common.noResults} />
            </div>
            <div id="kh-grid" className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
              {all.map((r, i) => (
                <div key={r.id} data-filter-item="" data-f-type={r.type} data-f-category={r.category} data-f-text={`${r.titleAr} ${r.titleEn} ${r.excerptAr} ${r.excerptEn}`}>
                  <Reveal delay={(i % 3) * 0.06}>
                    <ResourceCard r={r} locale={locale} t={t} />
                  </Reveal>
                </div>
              ))}
            </div>
            <DomFilter scope="kh-grid" params={["type", "category"]} noResultsId="kh-noresults" />
          </div>
        </div>
      </section>
    </>
  );
}