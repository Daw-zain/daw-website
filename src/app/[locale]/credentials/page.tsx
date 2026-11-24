import Image from "next/image";
import type { Metadata } from "next";
import { isLocale, PMI_REGISTRY_URL, type Locale } from "@/lib/constants";
import { getDictionary } from "@/lib/i18n";
import { getCredentials } from "@/lib/queries";
import { breadcrumbJsonLd, pageMeta } from "@/lib/seo";
import { pick } from "@/lib/utils";
import { PageHero, JsonLd } from "@/components/ui";
import { Reveal } from "@/components/motion";
import { AwardIcon, CapIcon, ShieldIcon } from "@/components/Icons";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const t = getDictionary(locale);
  return pageMeta({ locale, path: "/credentials", title: t.credentials.title, description: t.credentials.intro });
}

export default async function Credentials({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: l } = await params;
  const locale = l as Locale;
  const t = getDictionary(locale);
  const creds = await getCredentials();
  const L = (p: string) => `/${locale}${p}`;
  const groups = [
    { kind: "PROFESSIONAL", title: t.credentials.professional, Icon: AwardIcon },
    { kind: "ACADEMIC", title: t.credentials.academic, Icon: CapIcon },
  ];

  return (
    <>
      <PageHero title={t.credentials.title} text={t.credentials.intro} crumbs={[{ href: L(""), label: t.common.breadcrumbHome }, { label: t.nav.credentials }]} />
      <JsonLd data={breadcrumbJsonLd([{ name: t.common.breadcrumbHome, path: L("") }, { name: t.nav.credentials, path: L("/credentials") }])} />
      {groups.map((g, gi) => {
        const items = creds.filter((c) => c.kind === g.kind);
        if (!items.length) return null;
        return (
          <section key={g.kind} className={gi % 2 ? "bg-mist py-16" : "py-16"}>
            <div className="container-x">
              <h2 className="flex items-center gap-3 text-2xl font-bold">
                <g.Icon className="h-7 w-7 text-brand" />
                {g.title}
              </h2>
              <div className="mt-8 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                {items.map((c, i) => (
                  <Reveal key={c.id} delay={i * 0.08} className="card card-hover group relative flex flex-col overflow-hidden">
                    <div className="relative aspect-[4/3] bg-gradient-to-br from-navy via-navy-700 to-brand-600">
                      {c.image ? (
                        <Image src={c.image} alt={pick(c, "title", locale)} fill sizes="(min-width:1024px) 33vw, 100vw" className="bg-white object-contain p-8" />
                      ) : (
                        <div className="grid-bg absolute inset-0 grid place-items-center">
                          <div className="text-center" dir="ltr">
                            <span className="mx-auto grid h-20 w-20 place-items-center rounded-2xl border border-gold/60 bg-navy/40 text-gold backdrop-blur transition group-hover:scale-110">
                              {g.kind === "ACADEMIC" ? <CapIcon className="h-10 w-10" /> : <ShieldIcon className="h-10 w-10" />}
                            </span>
                            <p className="mt-4 text-2xl font-extrabold text-white">{c.code}</p>
                          </div>
                        </div>
                      )}
                    </div>
                    <div className="flex flex-1 flex-col p-6">
                      <h3 className="text-lg font-bold">{pick(c, "title", locale)}</h3>
                      {pick(c, "issuer", locale) && <p className="mt-1 text-sm text-slate">{pick(c, "issuer", locale)}</p>}
                      {pick(c, "description", locale) && <p className="mt-3 text-[15px] leading-7 text-slate">{pick(c, "description", locale)}</p>}
                      <dl className="mt-4 space-y-1 text-sm">
                        {c.year && (
                          <div className="flex gap-2">
                            <dt className="text-slate">{t.credentials.issued}:</dt>
                            <dd className="font-semibold text-navy" dir="ltr">
                              {c.year}
                            </dd>
                          </div>
                        )}
                        {c.credentialId && (
                          <div className="flex gap-2">
                            <dt className="text-slate">{t.credentials.id}:</dt>
                            <dd className="font-semibold text-navy" dir="ltr">
                              {c.credentialId}
                            </dd>
                          </div>
                        )}
                      </dl>
                      {g.kind === "PROFESSIONAL" && (
                        <a href={c.verifyUrl || PMI_REGISTRY_URL} target="_blank" rel="noopener noreferrer" className="mt-auto pt-5 text-sm font-semibold text-brand hover:underline">
                          {t.credentials.verify} ↗
                        </a>
                      )}
                    </div>
                  </Reveal>
                ))}
              </div>
              {g.kind === "PROFESSIONAL" && <p className="mt-8 text-sm text-slate">{t.credentials.verifyNote}</p>}
            </div>
          </section>
        );
      })}
    </>
  );
}
