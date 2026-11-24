import Link from "next/link";
import type { Metadata } from "next";
import { isLocale, RESOURCE_CATEGORIES, RESOURCE_TYPES, type Locale } from "@/lib/constants";
import { getDictionary } from "@/lib/i18n";
import { getResources } from "@/lib/queries";
import { breadcrumbJsonLd, pageMeta } from "@/lib/seo";
import { cn, normalizeText } from "@/lib/utils";
import { PageHero, JsonLd, EmptyState } from "@/components/ui";
import { ResourceCard } from "@/components/cards";
import { Reveal } from "@/components/motion";
import { SearchIcon } from "@/components/Icons";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const t = getDictionary(locale);
  return pageMeta({ locale, path: "/knowledge", title: t.knowledge.title, description: t.knowledge.intro });
}

type SP = { q?: string; type?: string; category?: string };

export default async function Knowledge({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<SP> }) {
  const { locale: l } = await params;
  const sp = await searchParams;
  const locale = l as Locale;
  const t = getDictionary(locale);
  const all = await getResources();
  const L = (p: string) => `/${locale}${p}`;

  const q = normalizeText(sp.q ?? "");
  const type = RESOURCE_TYPES.includes(sp.type as never) ? sp.type : undefined;
  const category = RESOURCE_CATEGORIES.includes(sp.category as never) ? sp.category : undefined;
  const list = all.filter(
    (r) =>
      (!type || r.type === type) &&
      (!category || r.category === category) &&
      (!q || normalizeText(`${r.titleAr} ${r.titleEn} ${r.excerptAr} ${r.excerptEn}`).includes(q)),
  );

  const qs = (patch: Partial<SP>) => {
    const next = { q: sp.q, type, category, ...patch };
    const s = new URLSearchParams(Object.entries(next).filter(([, v]) => v) as [string, string][]).toString();
    return L(`/knowledge${s ? `?${s}` : ""}`);
  };
  const chip = (active: boolean) =>
    cn("rounded-full border px-3.5 py-1.5 text-sm font-semibold transition", active ? "border-navy bg-navy text-white" : "border-line bg-white text-navy hover:border-brand hover:text-brand");

  return (
    <>
      <PageHero title={t.knowledge.title} text={t.knowledge.intro} crumbs={[{ href: L(""), label: t.common.breadcrumbHome }, { label: t.nav.knowledge }]}>
        <form action={L("/knowledge")} className="mt-8 flex max-w-xl gap-2" role="search">
          {type && <input type="hidden" name="type" value={type} />}
          {category && <input type="hidden" name="category" value={category} />}
          <label htmlFor="kq" className="sr-only">
            {t.knowledge.searchPlaceholder}
          </label>
          <div className="relative flex-1">
            <SearchIcon className="pointer-events-none absolute start-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate" />
            <input id="kq" name="q" defaultValue={sp.q} placeholder={t.knowledge.searchPlaceholder} className="field ps-12" type="search" />
          </div>
          <button className="btn btn-gold" type="submit">
            {t.nav.search}
          </button>
        </form>
      </PageHero>
      <JsonLd data={breadcrumbJsonLd([{ name: t.common.breadcrumbHome, path: L("") }, { name: t.nav.knowledge, path: L("/knowledge") }])} />

      <section className="py-14">
        <div className="container-x grid gap-10 lg:grid-cols-[260px_1fr]">
          <aside className="space-y-8 lg:sticky lg:top-28 lg:self-start">
            <div>
              <h2 className="text-sm font-bold uppercase tracking-wider text-slate">{t.knowledge.type}</h2>
              <div className="mt-3 flex flex-wrap gap-2">
                <Link href={qs({ type: undefined })} scroll={false} className={chip(!type)}>
                  {t.common.all}
                </Link>
                {RESOURCE_TYPES.map((x) => (
                  <Link key={x} href={qs({ type: x })} scroll={false} className={chip(type === x)}>
                    {t.categories.resourceType[x]}
                  </Link>
                ))}
              </div>
            </div>
            <div>
              <h2 className="text-sm font-bold uppercase tracking-wider text-slate">{t.knowledge.category}</h2>
              <div className="mt-3 flex flex-wrap gap-2">
                <Link href={qs({ category: undefined })} scroll={false} className={chip(!category)}>
                  {t.common.all}
                </Link>
                {RESOURCE_CATEGORIES.map((x) => (
                  <Link key={x} href={qs({ category: x })} scroll={false} className={chip(category === x)}>
                    {t.categories.resource[x]}
                  </Link>
                ))}
              </div>
            </div>
            <Link href={L("/account")} className="btn btn-outline btn-sm">
              {t.knowledge.savedList}
            </Link>
          </aside>
          <div>
            {list.length === 0 ? (
              <EmptyState text={all.length === 0 ? t.knowledge.empty : t.common.noResults} />
            ) : (
              <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
                {list.map((r, i) => (
                  <Reveal key={r.id} delay={(i % 3) * 0.06}>
                    <ResourceCard r={r} locale={locale} t={t} />
                  </Reveal>
                ))}
              </div>
            )}
          </div>
        </div>
      </section>
    </>
  );
}
