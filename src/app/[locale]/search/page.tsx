import Link from "next/link";
import type { Metadata } from "next";
import { isLocale, type Locale } from "@/lib/constants";
import { getDictionary } from "@/lib/i18n";
import { getPrograms, getResources, getServices } from "@/lib/queries";
import { pageMeta } from "@/lib/seo";
import { cn, normalizeText, pick } from "@/lib/utils";
import { PageHero, EmptyState } from "@/components/ui";
import { SearchIcon } from "@/components/Icons";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const t = getDictionary(locale);
  return pageMeta({ locale, path: "/search", title: t.search.title, noindex: true });
}

type Hit = { href: string; title: string; text: string; tag: string };

export default async function Search({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ q?: string; in?: string }> }) {
  const { locale: l } = await params;
  const sp = await searchParams;
  const locale = l as Locale;
  const t = getDictionary(locale);
  const L = (p: string) => `/${locale}${p}`;
  const raw = (sp.q ?? "").trim().slice(0, 100);
  const terms = normalizeText(raw).split(" ").filter(Boolean);
  const scope = ["programs", "services", "resources"].includes(sp.in ?? "") ? sp.in : undefined;

  const groups: { key: string; title: string; hits: Hit[] }[] = [];
  if (raw.length >= 2) {
    const [programs, services, resources] = await Promise.all([getPrograms(), getServices(), getResources()]);
    const match = (s: string) => {
      const n = normalizeText(s);
      return terms.every((w) => n.includes(w));
    };
    groups.push({
      key: "programs",
      title: t.search.programs,
      hits: programs
        .filter((p) => match(`${p.titleAr} ${p.titleEn} ${p.summaryAr} ${p.summaryEn} ${p.code ?? ""} ${p.outlineAr} ${p.outlineEn}`))
        .map((p) => ({ href: L(`/programs/${p.slug}`), title: pick(p, "title", locale), text: pick(p, "summary", locale), tag: (t.categories.program as Record<string, string>)[p.category] })),
    });
    groups.push({
      key: "services",
      title: t.search.services,
      hits: services
        .filter((s) => match(`${s.titleAr} ${s.titleEn} ${s.summaryAr} ${s.summaryEn} ${s.descriptionAr} ${s.descriptionEn}`))
        .map((s) => ({ href: L(`/consulting/${s.slug}`), title: pick(s, "title", locale), text: pick(s, "summary", locale), tag: t.nav.consulting })),
    });
    groups.push({
      key: "resources",
      title: t.search.resources,
      hits: resources
        .filter((r) => match(`${r.titleAr} ${r.titleEn} ${r.excerptAr} ${r.excerptEn}`))
        .map((r) => ({ href: L(`/knowledge/${r.slug}`), title: pick(r, "title", locale), text: pick(r, "excerpt", locale), tag: (t.categories.resourceType as Record<string, string>)[r.type] })),
    });
  }
  const total = groups.reduce((n, g) => n + g.hits.length, 0);
  const shown = scope ? groups.filter((g) => g.key === scope) : groups;
  const filterHref = (k?: string) => L(`/search?q=${encodeURIComponent(raw)}${k ? `&in=${k}` : ""}`);

  return (
    <>
      <PageHero title={t.search.title}>
        <form action={L("/search")} role="search" className="mt-8 flex max-w-2xl gap-2">
          <label htmlFor="sq" className="sr-only">
            {t.search.placeholder}
          </label>
          <div className="relative flex-1">
            <SearchIcon className="pointer-events-none absolute start-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate" />
            <input id="sq" name="q" type="search" defaultValue={raw} autoFocus placeholder={t.search.placeholder} className="field ps-12" minLength={2} />
          </div>
          <button className="btn btn-gold">{t.nav.search}</button>
        </form>
      </PageHero>
      <section className="py-14">
        <div className="container-x max-w-4xl">
          {raw.length < 2 ? (
            <p className="text-slate">{t.search.hint}</p>
          ) : (
            <>
              <p className="text-slate">
                {t.search.resultsFor} “<strong className="text-navy">{raw}</strong>” · <span dir="ltr">{total}</span>
              </p>
              <div className="mt-5 flex flex-wrap gap-2">
                {[{ k: undefined, label: t.common.all, n: total }, ...groups.map((g) => ({ k: g.key, label: g.title, n: g.hits.length }))].map((f) => (
                  <Link key={f.label} href={filterHref(f.k)} className={cn("rounded-full border px-3.5 py-1.5 text-sm font-semibold transition", scope === f.k ? "border-navy bg-navy text-white" : "border-line bg-white text-navy hover:border-brand")}>
                    {f.label} <span className="opacity-60">({f.n})</span>
                  </Link>
                ))}
              </div>
              {total === 0 ? (
                <div className="mt-8">
                  <EmptyState text={t.common.noResults} />
                </div>
              ) : (
                shown
                  .filter((g) => g.hits.length)
                  .map((g) => (
                    <div key={g.key} className="mt-10">
                      <h2 className="text-xl font-bold">{g.title}</h2>
                      <ul className="mt-4 space-y-3">
                        {g.hits.map((h) => (
                          <li key={h.href}>
                            <Link href={h.href} className="card card-hover block p-5">
                              <span className="text-xs font-semibold uppercase tracking-wider text-gold-600">{h.tag}</span>
                              <span className="mt-1 block text-lg font-bold text-navy">{h.title}</span>
                              <span className="mt-1 line-clamp-2 block text-[15px] text-slate">{h.text}</span>
                            </Link>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))
              )}
            </>
          )}
        </div>
      </section>
    </>
  );
}
