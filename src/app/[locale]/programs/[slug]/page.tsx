import Link from "next/link";
import Image from "next/image";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isLocale, type Locale } from "@/lib/constants";
import { getDictionary } from "@/lib/i18n";
import { getSettings } from "@/lib/settings";
import { getProgram, getPrograms, seatsLeft } from "@/lib/queries";
import { registrationOptions } from "@/lib/program-options";
import { breadcrumbJsonLd, pageMeta } from "@/lib/seo";
import { formatDate, lines, pick, siteUrl } from "@/lib/utils";
import { PageHero, JsonLd, ShareButtons, StatusChip, WhatsAppInquiry, EmptyState } from "@/components/ui";
import { Reveal } from "@/components/motion";
import { RegistrationForm } from "@/components/forms/RegistrationForm";
import { ProgramCard } from "@/components/cards";
import { CalendarIcon, CheckIcon, ClockIcon, LayersIcon, PinIcon, TargetIcon, UsersIcon } from "@/components/Icons";

type Props = { params: Promise<{ locale: string; slug: string }>; searchParams: Promise<{ session?: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, slug } = await params;
  if (!isLocale(locale)) return {};
  const p = await getProgram(slug);
  if (!p) return {};
  return pageMeta({
    locale,
    path: `/programs/${p.slug}`,
    title: pick(p, "metaTitle", locale) || pick(p, "title", locale),
    description: pick(p, "metaDesc", locale) || pick(p, "summary", locale),
    image: p.image,
  });
}

function ListBlock({ title, items, icon: Icon }: { title: string; items: string[]; icon: typeof CheckIcon }) {
  if (!items.length) return null;
  return (
    <Reveal className="card p-7">
      <h2 className="flex items-center gap-3 text-xl font-bold">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-sky text-brand">
          <Icon className="h-5 w-5" />
        </span>
        {title}
      </h2>
      <ul className="mt-5 space-y-3">
        {items.map((it, i) => (
          <li key={i} className="flex gap-3 leading-7 text-ink/90">
            <CheckIcon className="mt-1.5 h-4 w-4 shrink-0 text-gold-600" />
            {it}
          </li>
        ))}
      </ul>
    </Reveal>
  );
}

export default async function ProgramPage({ params, searchParams }: Props) {
  const { locale: l, slug } = await params;
  const { session: sessionParam } = await searchParams;
  const locale = l as Locale;
  const t = getDictionary(locale);
  const p = await getProgram(slug);
  if (!p) notFound();
  const [settings, options, all] = await Promise.all([getSettings(), registrationOptions(locale), getPrograms()]);
  const L = (x: string) => `/${locale}${x}`;
  const title = pick(p, "title", locale);
  const duration = pick(p, "duration", locale);
  const canRegister = p.status === "OPEN" || p.status === "COMING_SOON";
  const outline = lines(pick(p, "outline", locale));
  const url = siteUrl(L(`/programs/${p.slug}`));
  const waText = `${locale === "ar" ? settings.whatsappMessageAr : settings.whatsappMessageEn} ${title}`;
  const related = all.filter((x) => x.id !== p.id && x.category === p.category).slice(0, 3);

  const courseLd = {
    "@context": "https://schema.org",
    "@type": "Course",
    name: title,
    description: pick(p, "summary", locale),
    url,
    inLanguage: locale,
    provider: { "@type": "Person", name: "Daw Zainelabideen", url: siteUrl(L("")) },
    ...(p.sessions.length
      ? {
          hasCourseInstance: p.sessions.map((s) => ({
            "@type": "CourseInstance",
            courseMode: s.mode === "ONLINE" ? "online" : s.mode === "HYBRID" ? "blended" : "onsite",
            startDate: s.startDate.toISOString().slice(0, 10),
            ...(s.endDate ? { endDate: s.endDate.toISOString().slice(0, 10) } : {}),
            ...(pick(s, "location", locale) ? { location: pick(s, "location", locale) } : {}),
          })),
        }
      : {}),
  };

  return (
    <>
      <PageHero
        eyebrow={(t.categories.program as Record<string, string>)[p.category]}
        title={title}
        text={pick(p, "summary", locale)}
        crumbs={[{ href: L(""), label: t.common.breadcrumbHome }, { href: L("/programs"), label: t.nav.programs }, { label: title }]}
      >
        <div className="mt-8 flex flex-wrap items-center gap-3">
          <StatusChip status={p.status} label={(t.status.program as Record<string, string>)[p.status]} />
          {duration && (
            <span className="chip bg-white/10 text-white">
              <ClockIcon className="h-3.5 w-3.5" /> {duration}
            </span>
          )}
          {p.hours && (
            <span className="chip bg-white/10 text-white">
              {p.hours} {t.common.hours}
            </span>
          )}
        </div>
        <div className="mt-8 flex flex-wrap gap-3">
          {canRegister && (
            <a href="#register" className="btn btn-gold">
              {p.status === "OPEN" ? t.cta.enroll : t.cta.registerInterest}
            </a>
          )}
          <Link href={L(`/corporate?program=${p.slug}#request`)} className="btn btn-ghost-light">
            {t.cta.corporate}
          </Link>
        </div>
      </PageHero>
      <JsonLd data={[courseLd, breadcrumbJsonLd([{ name: t.common.breadcrumbHome, path: L("") }, { name: t.nav.programs, path: L("/programs") }, { name: title, path: L(`/programs/${p.slug}`) }])]} />

      <section className="py-16">
        <div className="container-x grid gap-10 lg:grid-cols-[1fr_380px]">
          <div className="space-y-8">
            {p.image && (
              <div className="relative aspect-[16/7] overflow-hidden rounded-3xl">
                <Image src={p.image} alt="" fill sizes="(min-width:1024px) 800px, 100vw" className="object-cover" priority />
              </div>
            )}
            <Reveal>
              <h2 className="text-2xl font-bold">{t.programs.overview}</h2>
              <div className="prose-site mt-3">
                {pick(p, "description", locale)
                  .split(/\n{2,}/)
                  .map((para, i) => (
                    <p key={i}>{para}</p>
                  ))}
              </div>
            </Reveal>
            <div className="grid gap-6 md:grid-cols-2">
              <ListBlock title={t.programs.objectives} items={lines(pick(p, "objectives", locale))} icon={TargetIcon} />
              <ListBlock title={t.programs.audience} items={lines(pick(p, "audience", locale))} icon={UsersIcon} />
              <ListBlock title={t.programs.prerequisites} items={lines(pick(p, "prerequisites", locale))} icon={LayersIcon} />
              <ListBlock title={t.programs.outcomes} items={lines(pick(p, "outcomes", locale))} icon={CheckIcon} />
            </div>

            {outline.length > 0 && (
              <Reveal className="card p-7">
                <h2 className="text-xl font-bold">{t.programs.outline}</h2>
                <ol className="mt-6 grid gap-3">
                  {outline.map((o, i) => (
                    <li key={i} className="group flex items-center gap-4 rounded-xl border border-line p-4 transition hover:border-brand/40 hover:bg-sky-50">
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-navy text-sm font-bold text-gold transition group-hover:bg-brand group-hover:text-white" dir="ltr">
                        {String(i + 1).padStart(2, "0")}
                      </span>
                      <span className="font-medium text-navy">{o}</span>
                    </li>
                  ))}
                </ol>
              </Reveal>
            )}

            {/* Sessions */}
            <Reveal>
              <h2 className="flex items-center gap-2 text-2xl font-bold">
                <CalendarIcon className="h-6 w-6 text-brand" />
                {t.programs.schedule}
              </h2>
              <div className="mt-5">
                {p.sessions.length === 0 ? (
                  <EmptyState text={t.programs.noSessions} />
                ) : (
                  <ul className="grid gap-4">
                    {p.sessions.map((s) => {
                      const left = seatsLeft(s);
                      const full = s.status === "FULL" || left === 0;
                      return (
                        <li key={s.id} className="card flex flex-wrap items-center justify-between gap-4 p-5">
                          <div>
                            <p className="font-bold text-navy">
                              {formatDate(s.startDate, locale)}
                              {s.endDate ? ` – ${formatDate(s.endDate, locale)}` : ""}
                            </p>
                            <p className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate">
                              <span>{(t.status.mode as Record<string, string>)[s.mode]}</span>
                              {pick(s, "schedule", locale) && <span>{pick(s, "schedule", locale)}</span>}
                              {pick(s, "location", locale) && (
                                <span className="inline-flex items-center gap-1">
                                  <PinIcon className="h-3.5 w-3.5" />
                                  {pick(s, "location", locale)}
                                </span>
                              )}
                              <span>{left == null ? t.programs.seatsTba : `${left} ${t.programs.seatsLeft}`}</span>
                            </p>
                          </div>
                          {full || s.status !== "OPEN" ? (
                            <StatusChip status={full ? "FULL" : s.status} label={full ? t.status.session.FULL : (t.status.session as Record<string, string>)[s.status]} />
                          ) : (
                            <Link href={`?session=${s.id}#register`} scroll={false} className="btn btn-primary btn-sm">
                              {t.cta.enroll}
                            </Link>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </Reveal>

            <ShareButtons url={url} title={title} label={t.common.share} />
          </div>

          {/* Sidebar */}
          <aside className="space-y-6 lg:sticky lg:top-28 lg:self-start">
            <div className="card p-6">
              <dl className="space-y-4 text-[15px]">
                <div>
                  <dt className="text-sm text-slate">{t.programs.status}</dt>
                  <dd className="mt-1">
                    <StatusChip status={p.status} label={(t.status.program as Record<string, string>)[p.status]} />
                  </dd>
                </div>
                <div>
                  <dt className="text-sm text-slate">{t.programs.duration}</dt>
                  <dd className="mt-1 font-semibold text-navy">{duration || (p.hours ? `${p.hours} ${t.common.hours}` : t.common.tba)}</dd>
                </div>
                <div>
                  <dt className="text-sm text-slate">{t.programs.delivery}</dt>
                  <dd className="mt-1 text-navy">{pick(p, "delivery", locale) || t.common.tba}</dd>
                </div>
                {p.sessions[0] && (
                  <div>
                    <dt className="text-sm text-slate">{t.programs.schedule}</dt>
                    <dd className="mt-1 font-semibold text-navy">{formatDate(p.sessions[0].startDate, locale)}</dd>
                  </div>
                )}
              </dl>
              <div className="mt-6 grid gap-2">
                {canRegister && (
                  <a href="#register" className="btn btn-primary">
                    {p.status === "OPEN" ? t.cta.enroll : t.cta.registerInterest}
                  </a>
                )}
                <Link href={L(`/corporate?program=${p.slug}#request`)} className="btn btn-outline">
                  {t.cta.corporate}
                </Link>
                <WhatsAppInquiry number={settings.whatsapp} text={waText} label={t.common.sendInquiry} />
              </div>
            </div>
            <p className="rounded-xl bg-mist p-4 text-xs leading-6 text-slate">{t.programs.pmiNote}</p>
          </aside>
        </div>
      </section>

      {canRegister && (
        <section id="register" className="scroll-mt-24 bg-mist py-16">
          <div className="container-x max-w-3xl">
            <Reveal className="card p-8 sm:p-10">
              <h2 className="text-2xl font-bold">{t.programs.registerTitle}</h2>
              <p className="mt-1 text-slate">{title}</p>
              <div className="mt-8">
                <RegistrationForm
                  locale={locale}
                  t={t.forms}
                  programs={options}
                  defaultProgram={p.id}
                  defaultSession={sessionParam}
                  noSessionLabel={t.forms.noSessionOption}
                  lockProgram
                  exploreLabel={t.cta.explore}
                />
              </div>
            </Reveal>
          </div>
        </section>
      )}

      {related.length > 0 && (
        <section className="py-16">
          <div className="container-x">
            <h2 className="text-2xl font-bold">{t.programs.related}</h2>
            <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {related.map((r) => (
                <ProgramCard key={r.id} p={r} locale={locale} t={t} />
              ))}
            </div>
          </div>
        </section>
      )}
    </>
  );
}
