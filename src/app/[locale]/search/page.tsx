import type { Metadata } from "next";
import { isLocale, type Locale } from "@/lib/constants";
import { getDictionary } from "@/lib/i18n";
import { getPrograms, getResources, getServices } from "@/lib/queries";
import { pageMeta } from "@/lib/seo";
import { normalizeText, pick } from "@/lib/utils";
import { PageHero } from "@/components/ui";
import { QuerySearchBox } from "@/components/QueryFilters";
import { SearchResults, type SearchDoc } from "@/components/SearchResults";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const t = getDictionary(locale);
  return pageMeta({ locale, path: "/search", title: t.search.title, noindex: true });
}

export default async function Search({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: l } = await params;
  const locale = l as Locale;
  const t = getDictionary(locale);
  const L = (p: string) => `/${locale}${p}`;
  const [programs, services, resources] = await Promise.all([getPrograms(), getServices(), getResources()]);
  const docs: SearchDoc[] = [
    ...programs.map((p) => ({
      group: "programs",
      href: L(`/programs/${p.slug}`),
      title: pick(p, "title", locale),
      text: pick(p, "summary", locale),
      tag: (t.categories.program as Record<string, string>)[p.category],
      haystack: normalizeText(`${p.titleAr} ${p.titleEn} ${p.summaryAr} ${p.summaryEn} ${p.code ?? ""} ${p.outlineAr} ${p.outlineEn}`),
    })),
    ...services.map((s) => ({
      group: "services",
      href: L(`/consulting/${s.slug}`),
      title: pick(s, "title", locale),
      text: pick(s, "summary", locale),
      tag: t.nav.consulting,
      haystack: normalizeText(`${s.titleAr} ${s.titleEn} ${s.summaryAr} ${s.summaryEn} ${s.descriptionAr} ${s.descriptionEn}`),
    })),
    ...resources.map((r) => ({
      group: "resources",
      href: L(`/knowledge/${r.slug}`),
      title: pick(r, "title", locale),
      text: pick(r, "excerpt", locale),
      tag: (t.categories.resourceType as Record<string, string>)[r.type],
      haystack: normalizeText(`${r.titleAr} ${r.titleEn} ${r.excerptAr} ${r.excerptEn}`),
    })),
  ];

  return (
    <>
      <PageHero title={t.search.title}>
        <QuerySearchBox id="sq" placeholder={t.search.placeholder} button={t.nav.search} autoFocus minLength={2} />
      </PageHero>
      <section className="py-14">
        <div className="container-x max-w-4xl">
          <SearchResults
            docs={docs}
            labels={{
              all: t.common.all,
              hint: t.search.hint,
              resultsFor: t.search.resultsFor,
              noResults: t.common.noResults,
              groups: { programs: t.search.programs, services: t.search.services, resources: t.search.resources },
            }}
          />
        </div>
      </section>
    </>
  );
}