import Link from "next/link";
import Image from "next/image";
import type { Metadata } from "next";
import { isLocale, type Locale } from "@/lib/constants";
import { getDictionary } from "@/lib/i18n";
import { getSettings } from "@/lib/settings";
import { getCredentials, getPrograms, getResources, getServices, getStats, getTestimonials } from "@/lib/queries";
import { pageMeta } from "@/lib/seo";
import { pick } from "@/lib/utils";
import { HeroBackdrop, HeroVisual } from "@/components/HeroVisual";
import { Counter, Reveal } from "@/components/motion";
import { ArrowLink, SectionHeading } from "@/components/ui";
import { ProgramCard, ResourceCard, ServiceCard } from "@/components/cards";
import { NewsletterForm } from "@/components/forms/NewsletterForm";
import { ArrowIcon, AwardIcon, BuildingIcon, CapIcon, CheckIcon, CycleIcon, LayersIcon, ShieldIcon, SparkIcon, TargetIcon, UsersIcon } from "@/components/Icons";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  return isLocale(locale) ? pageMeta({ locale, path: "/" }) : {};
}

const PMI_PROGRAMS: Record<string, string> = {
  "CAPM®": "capm-exam-preparation",
  "PMP®": "pmp-exam-preparation",
  "PMI-ACP®": "pmi-acp-exam-preparation",
  "PMI-RMP®": "pmi-rmp-exam-preparation",
};
const whyIcons = [AwardIcon, CapIcon, BuildingIcon, LayersIcon, TargetIcon, UsersIcon];
const credIcons: Record<string, typeof ShieldIcon> = { PMP: ShieldIcon, "PMI-RMP": TargetIcon, "PMI-ACP": CycleIcon };

export default async function Home({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: l } = await params;
  const locale = l as Locale;
  const t = getDictionary(locale);
  const [settings, programs, services, credentials, stats, testimonials, resources] = await Promise.all([
    getSettings(),
    getPrograms(),
    getServices(),
    getCredentials(),
    getStats(),
    getTestimonials(),
    getResources(),
  ]);
  const L = (p: string) => `/${locale}${p}`;
  const heroTitle = (locale === "ar" ? settings.heroTitleAr : settings.heroTitleEn)?.split("\n").filter(Boolean);
  const titleLines = heroTitle?.length ? heroTitle : t.home.heroTitle;
  const heroText = (locale === "ar" ? settings.heroTextAr : settings.heroTextEn) || t.home.heroText;
  const pro = credentials.filter((c) => c.kind === "PROFESSIONAL");
  const academic = credentials.filter((c) => c.kind === "ACADEMIC");
  const featured = [...programs.filter((p) => p.featured), ...programs.filter((p) => !p.featured)].slice(0, 6);

  return (
    <>
      {/* ───────────── HERO ───────────── */}
      <section className="relative isolate overflow-hidden bg-navy text-white">
        <div className="grid-bg absolute inset-0 -z-10" aria-hidden="true" />
        <div className="absolute -end-40 -top-40 -z-10 h-[34rem] w-[34rem] rounded-full bg-brand/40 blur-3xl animate-float-slow" aria-hidden="true" />
        <div className="absolute -bottom-40 start-0 -z-10 h-[26rem] w-[26rem] rounded-full bg-gold/10 blur-3xl animate-float" aria-hidden="true" />
        <div className="absolute inset-0 -z-10 opacity-60">
          <HeroBackdrop />
        </div>

        <div className="container-x grid items-center gap-14 pb-24 pt-14 sm:pt-20 lg:grid-cols-[1.15fr_1fr] lg:pb-28">
          <div>
            {settings.partnerLogo && (
              <div className="fade-up group mb-8 inline-flex items-center gap-4 rounded-2xl bg-white px-4 py-3 shadow-xl ring-1 ring-white/30 transition hover:-translate-y-0.5 hover:shadow-2xl sm:px-5">
                <Image src={settings.partnerLogo} alt={t.home.partnerName} width={114} height={80} priority className="h-12 w-auto transition-transform duration-300 group-hover:scale-105 sm:h-16" />
                <span className="h-10 w-px bg-line sm:h-12" aria-hidden="true" />
                <span className="text-sm font-bold leading-snug text-[#353a98] sm:text-base">{t.home.partnerName}</span>
              </div>
            )}
            <p className="eyebrow fade-up text-gold">{t.home.eyebrow}</p>
            <h1 className="mt-5 space-y-3 text-[2.05rem] font-bold leading-[1.35] text-white sm:space-y-4 sm:text-5xl lg:text-[3.4rem]">
              {titleLines.map((line, i) => (
                <span key={i} className="fade-up block" style={{ animationDelay: `${100 + i * 120}ms` }}>
                  <span className={i === titleLines.length - 1 ? "bg-gradient-to-r from-gold via-[#e2c78f] to-gold bg-clip-text text-transparent" : undefined}>{line}</span>
                </span>
              ))}
            </h1>
            <p className="fade-up mt-6 max-w-xl text-lg leading-relaxed text-white/75" style={{ animationDelay: "450ms" }}>
              {heroText}
            </p>
            <div className="fade-up" style={{ animationDelay: "550ms" }}>
              <div className="mt-9 flex flex-wrap gap-3">
                <Link href={L("/programs")} className="btn btn-gold group">
                  {t.cta.explore}
                  <ArrowIcon className="h-4 w-4 transition-transform group-hover:translate-x-1 rtl:group-hover:-translate-x-1" />
                </Link>
                <Link href={L("/consulting#request")} className="btn btn-ghost-light">
                  {t.cta.consult}
                </Link>
              </div>
            </div>
            <div className="fade-up" style={{ animationDelay: "650ms" }}>
              <ul className="mt-10 flex flex-wrap gap-x-6 gap-y-3 text-sm text-white/70">
                {["PMP®", "PMI-RMP®", "PMI-ACP®", locale === "ar" ? "جامعة برمنغهام" : "University of Birmingham"].map((x) => (
                  <li key={x} className="inline-flex items-center gap-2">
                    <CheckIcon className="h-4 w-4 text-gold" />
                    <span dir="auto">{x}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <HeroVisual image={settings.heroImage || undefined} alt={t.home.portraitAlt} labels={{ a: "PMP®", b: "PMI-RMP®", c: "PMI-ACP®" }} badges={["PMP", "PMI-RMP", "PMI-ACP"].map((code) => pro.find((c) => c.code === code)?.image)} />
        </div>
      </section>

      {/* ───────────── CREDENTIALS STRIP ───────────── */}
      <section className="relative z-10 -mt-12">
        <div className="container-x">
          <div className="card grid gap-px overflow-hidden bg-line md:grid-cols-3">
            {pro.map((c, i) => {
              const Icon = credIcons[c.code ?? ""] ?? AwardIcon;
              return (
                <Reveal key={c.id} delay={i * 0.08} className="group bg-white p-6 transition hover:bg-sky-50">
                  <div className="flex items-start gap-4">
                    {c.image ? (
                      <Image src={c.image} alt={pick(c, "title", locale)} width={64} height={64} className="h-16 w-16 shrink-0 rounded-full object-cover transition group-hover:scale-110" />
                    ) : (
                      <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-navy text-gold transition group-hover:scale-110">
                        <Icon className="h-6 w-6" />
                      </span>
                    )}
                    <div>
                      <p className="text-lg font-bold text-navy" dir="ltr">
                        {c.code}®
                      </p>
                      <p className="mt-1 text-sm leading-6 text-slate">{pick(c, "title", locale)}</p>
                    </div>
                  </div>
                </Reveal>
              );
            })}
          </div>
        </div>
      </section>

      {/* ───────────── PMI AUTHORIZED TRAINING PARTNER ───────────── */}
      {settings.atpBadge && (
        <section className="pt-16">
          <div className="container-x">
            <Reveal className="relative overflow-hidden rounded-3xl border border-[#5b2d8e]/15 bg-gradient-to-br from-[#f6f1fb] via-white to-sky-50 p-6 sm:p-8">
              <div className="grid-bg-dark absolute inset-0 opacity-60" aria-hidden="true" />
              <div className="relative flex flex-col items-center gap-6 text-center sm:flex-row sm:text-start">
                <div className="logo-portrait relative h-28 w-28 shrink-0 rounded-full p-[3px] sm:h-32 sm:w-32">
                  <span className="logo-halo absolute -inset-2 rounded-full" aria-hidden="true" />
                  <Image src={settings.atpBadge} alt={t.home.atpTitle} width={128} height={128} className="relative h-full w-full rounded-full object-contain transition-transform duration-500 hover:scale-105" />
                </div>
                <div>
                  <h2 className="text-2xl font-bold text-navy">{t.home.atpTitle}</h2>
                  <p className="mt-2 max-w-2xl leading-7 text-slate">{t.home.atpText}</p>
                  <div className="mt-4 flex flex-wrap justify-center gap-2 sm:justify-start" dir="ltr">
                    {["PMP®", "PMI-RMP®", "PMI-ACP®", "CAPM®"].map((x) => (
                      <span key={x} className="chip bg-white text-[#5b2d8e] ring-1 ring-[#5b2d8e]/20">
                        {x}
                      </span>
                    ))}
                  </div>
                </div>
                <Link href={L("/programs?category=certification")} className="btn btn-primary shrink-0 sm:ms-auto">
                  {t.cta.explore}
                </Link>
              </div>
            </Reveal>
          </div>
        </section>
      )}
      {/* ───────────── ALDALEEL RAQAMEE ───────────── */}
      {settings.partnerLogo && (
        <section className="pt-6">
          <div className="container-x">
            <Reveal className="group flex flex-col items-center gap-5 rounded-3xl border border-line bg-white p-6 text-center shadow-card transition hover:border-[#353a98]/30 hover:shadow-lift sm:flex-row sm:p-7 sm:text-start">
              <div className="flex h-20 w-28 shrink-0 items-center justify-center rounded-2xl bg-white p-2 ring-1 ring-line transition-transform duration-500 group-hover:scale-105">
                <Image src={settings.partnerLogo} alt={t.home.partnerName} width={112} height={79} className="h-full w-full object-contain" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-[#353a98]">{t.home.partnerName}</h2>
                <p className="mt-1 leading-7 text-slate">{t.home.partnerText}</p>
              </div>
            </Reveal>
          </div>
        </section>
      )}
      {/* ───────────── ABOUT PMI ───────────── */}
      <section className="pt-20">
        <div className="container-x">
          <div className="grid gap-10 lg:grid-cols-[1fr_1.15fr] lg:items-start">
            <div>
              <SectionHeading eyebrow={t.pmi.eyebrow} title={t.pmi.title} text={t.pmi.intro} />
              <ul className="mt-8 space-y-4">
                {t.pmi.pillars.map((p, i) => (
                  <Reveal key={p.title} as="li" delay={i * 0.08} className="flex gap-4">
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#5b2d8e] text-sm font-bold text-white" dir="ltr">
                      0{i + 1}
                    </span>
                    <div>
                      <h3 className="font-bold text-navy">{p.title}</h3>
                      <p className="mt-0.5 leading-7 text-slate">{p.text}</p>
                    </div>
                  </Reveal>
                ))}
              </ul>
            </div>
            <Reveal delay={0.1} className="card relative overflow-hidden p-6 sm:p-8">
              <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-[#5b2d8e] via-brand to-gold" aria-hidden="true" />
              <h3 className="text-xl font-bold">{t.pmi.certsTitle}</h3>
              <div className="mt-6 grid gap-4 sm:grid-cols-2">
                {t.pmi.groups.map((g) => (
                  <div key={g.title} className="rounded-2xl border border-line bg-mist/60 p-4 transition hover:border-[#5b2d8e]/30 hover:bg-white">
                    <p className="text-sm font-bold text-navy">{g.title}</p>
                    <div className="mt-3 flex flex-wrap gap-2" dir="ltr">
                      {g.codes.map((code) => {
                        const slug = PMI_PROGRAMS[code];
                        return slug ? (
                          <Link key={code} href={L(`/programs/${slug}`)} title={t.pmi.offered} className="chip bg-gold/20 text-gold-600 ring-1 ring-gold/40 transition hover:bg-gold hover:text-navy">
                            {code} ✓
                          </Link>
                        ) : (
                          <span key={code} className="chip bg-white text-[#5b2d8e] ring-1 ring-[#5b2d8e]/15">
                            {code}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
              <p className="mt-5 flex items-center gap-2 text-sm text-slate">
                <span className="chip bg-gold/20 text-gold-600 ring-1 ring-gold/40" dir="ltr">✓</span>
                {t.pmi.offered}
              </p>
              <p className="mt-3 text-xs leading-6 text-slate">{t.pmi.note}</p>
            </Reveal>
          </div>
        </div>
      </section>
      {/* ───────────── ABOUT SNAPSHOT + ACADEMIC ───────────── */}
      <section className="py-24">
        <div className="container-x grid gap-12 lg:grid-cols-2 lg:items-center">
          <div>
            <SectionHeading eyebrow={t.nav.about} title={locale === "ar" ? "ضوء زين العابدين" : "Daw Zainelabideen"} text={t.about.intro} />
            <Reveal delay={0.1}>
              <p className="lead mt-5">{t.about.bio[1]}</p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Link href={L("/about")} className="btn btn-primary">
                  {t.common.learnMore}
                </Link>
                <Link href={settings.cvUrl || L("/cv")} className="btn btn-outline" {...(settings.cvUrl ? { target: "_blank" } : {})}>
                  {t.cta.cv}
                </Link>
              </div>
            </Reveal>
          </div>
          <Reveal delay={0.15}>
            <div className="relative rounded-3xl bg-mist p-8">
              <div className="grid-bg-dark absolute inset-0 rounded-3xl" aria-hidden="true" />
              <h3 className="relative flex items-center gap-2 text-lg font-bold">
                <CapIcon className="h-6 w-6 text-brand" />
                {t.home.academicTitle}
              </h3>
              <ol className="relative mt-6 space-y-6 border-s-2 border-brand/20 ps-6">
                {[
                  ...academic.map((c) => ({ key: c.id, year: c.year ?? 0, when: pick(c, "description", locale) || String(c.year ?? ""), title: pick(c, "title", locale), sub: pick(c, "issuer", locale), dot: "bg-gold" })),
                  { key: "career", year: 1990, when: locale === "ar" ? "1990 – الآن" : "1990 – present", title: t.about.experience[0].title, sub: "", dot: "bg-brand" },
                ]
                  .sort((a, b) => a.year - b.year)
                  .map((it) => (
                    <li key={it.key} className="relative">
                      <span className={`absolute -start-[33px] top-1 h-4 w-4 rounded-full border-4 border-mist ${it.dot}`} aria-hidden="true" />
                      <p className="text-sm font-bold text-brand">{it.when}</p>
                      <p className="mt-1 font-semibold text-navy">{it.title}</p>
                      {it.sub && <p className="text-sm text-slate">{it.sub}</p>}
                    </li>
                  ))}
              </ol>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ───────────── PROGRAMS ───────────── */}
      <section className="bg-mist py-24">
        <div className="container-x">
          <div className="flex flex-wrap items-end justify-between gap-6">
            <SectionHeading eyebrow={t.home.programsEyebrow} title={t.home.programsTitle} text={t.home.programsText} />
            <Reveal>
              <ArrowLink href={L("/programs")}>{t.common.viewAll}</ArrowLink>
            </Reveal>
          </div>
          <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {featured.map((p, i) => (
              <Reveal key={p.id} delay={(i % 3) * 0.08}>
                <ProgramCard p={p} locale={locale} t={t} />
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ───────────── CONSULTING ───────────── */}
      <section className="py-24">
        <div className="container-x">
          <div className="flex flex-wrap items-end justify-between gap-6">
            <SectionHeading eyebrow={t.home.consultingEyebrow} title={t.home.consultingTitle} text={t.home.consultingText} />
            <Reveal>
              <ArrowLink href={L("/consulting")}>{t.common.viewAll}</ArrowLink>
            </Reveal>
          </div>
          <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {services.slice(0, 8).map((s, i) => (
              <Reveal key={s.id} delay={(i % 4) * 0.06}>
                <ServiceCard s={s} locale={locale} t={t} />
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ───────────── WHY LEARN WITH ME ───────────── */}
      <section className="relative overflow-hidden bg-navy py-24 text-white">
        <div className="grid-bg absolute inset-0" aria-hidden="true" />
        <div className="absolute -start-32 top-1/3 h-80 w-80 rounded-full bg-brand/30 blur-3xl" aria-hidden="true" />
        <div className="container-x relative">
          <SectionHeading eyebrow={t.home.whyEyebrow} title={t.home.whyTitle} light center />
          <div className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {t.home.why.map((w, i) => {
              const Icon = whyIcons[i % whyIcons.length];
              return (
                <Reveal key={w.title} delay={(i % 3) * 0.08}>
                  <div className="group h-full rounded-2xl border border-white/10 bg-white/[0.04] p-7 backdrop-blur transition duration-300 hover:-translate-y-1 hover:border-gold/40 hover:bg-white/[0.07]">
                    <span className="grid h-12 w-12 place-items-center rounded-xl bg-gold/15 text-gold transition group-hover:bg-gold group-hover:text-navy">
                      <Icon className="h-6 w-6" />
                    </span>
                    <h3 className="mt-5 text-lg font-bold text-white">{w.title}</h3>
                    <p className="mt-2 leading-7 text-white/70">{w.text}</p>
                  </div>
                </Reveal>
              );
            })}
          </div>
        </div>
      </section>

      {/* ───────────── STATS (verified only) ───────────── */}
      {stats.length > 0 && (
        <section className="border-b border-line py-16">
          <div className="container-x">
            <h2 className="sr-only">{t.home.statsTitle}</h2>
            <dl className="grid gap-8 text-center sm:grid-cols-2 lg:grid-cols-4">
              {stats.map((s, i) => (
                <Reveal key={s.id} delay={i * 0.08} className="flex flex-col-reverse">
                  <dt className="mt-2 text-[15px] text-slate">{pick(s, "label", locale)}</dt>
                  <dd className="text-5xl font-extrabold text-navy">
                    <Counter value={s.value} prefix={s.prefix} suffix={s.suffix} animateIt={s.animate} />
                  </dd>
                </Reveal>
              ))}
            </dl>
          </div>
        </section>
      )}

      {/* ───────────── CORPORATE ───────────── */}
      <section className="py-24">
        <div className="container-x">
          <div className="relative overflow-hidden rounded-[2rem] bg-gradient-to-br from-brand-600 via-brand to-navy-700 p-8 text-white sm:p-14">
            <div className="grid-bg absolute inset-0" aria-hidden="true" />
            <div className="absolute -end-20 -top-20 h-72 w-72 rounded-full bg-gold/25 blur-3xl animate-float" aria-hidden="true" />
            <div className="relative grid gap-10 lg:grid-cols-2 lg:items-center">
              <div>
                <p className="eyebrow text-gold">{t.home.corporateEyebrow}</p>
                <h2 className="h-section mt-3 text-white">{t.home.corporateTitle}</h2>
                <p className="mt-4 text-lg leading-relaxed text-white/80">{t.home.corporateText}</p>
                <div className="mt-8 flex flex-wrap gap-3">
                  <Link href={L("/corporate#request")} className="btn btn-gold">
                    {t.cta.corporate}
                  </Link>
                  <Link href={L("/corporate")} className="btn btn-ghost-light">
                    {t.common.learnMore}
                  </Link>
                </div>
              </div>
              <ul className="grid gap-3 sm:grid-cols-2">
                {t.corporate.what.map((w, i) => (
                  <Reveal key={w.title} as="li" delay={i * 0.05} className="flex items-start gap-3 rounded-xl bg-white/10 p-4 backdrop-blur">
                    <CheckIcon className="mt-0.5 h-5 w-5 shrink-0 text-gold" />
                    <span className="text-[15px] font-medium">{w.title}</span>
                  </Reveal>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* ───────────── TESTIMONIALS (real, consented only) ───────────── */}
      {testimonials.length > 0 && (
        <section className="bg-mist py-24">
          <div className="container-x">
            <SectionHeading eyebrow={t.home.testimonialsEyebrow} title={t.home.testimonialsTitle} center />
            <div className="mt-12 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              {testimonials.slice(0, 6).map((q, i) => (
                <Reveal key={q.id} delay={(i % 3) * 0.08}>
                  <figure className="card h-full p-7">
                    <span className="text-5xl leading-none text-gold" aria-hidden="true">
                      “
                    </span>
                    <blockquote className="mt-2 leading-8 text-ink/90">{pick(q, "quote", locale)}</blockquote>
                    <figcaption className="mt-6 border-t border-line pt-4">
                      <p className="font-bold text-navy">{q.name}</p>
                      {pick(q, "role", locale) && <p className="text-sm text-slate">{pick(q, "role", locale)}</p>}
                    </figcaption>
                  </figure>
                </Reveal>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ───────────── LATEST RESOURCES ───────────── */}
      {resources.length > 0 && (
        <section className="py-24">
          <div className="container-x">
            <div className="flex flex-wrap items-end justify-between gap-6">
              <SectionHeading eyebrow={t.home.latestEyebrow} title={t.home.latestTitle} />
              <Reveal>
                <ArrowLink href={L("/knowledge")}>{t.common.viewAll}</ArrowLink>
              </Reveal>
            </div>
            <div className="mt-12 grid gap-6 md:grid-cols-3">
              {resources.slice(0, 3).map((r, i) => (
                <Reveal key={r.id} delay={i * 0.08}>
                  <ResourceCard r={r} locale={locale} t={t} />
                </Reveal>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ───────────── FINAL CTA + NEWSLETTER ───────────── */}
      <section className="pb-24">
        <div className="container-x grid gap-6 lg:grid-cols-[1.4fr_1fr]">
          <Reveal className="relative overflow-hidden rounded-[2rem] bg-navy p-10 text-white sm:p-14">
            <div className="grid-bg absolute inset-0" aria-hidden="true" />
            <SparkIcon className="absolute end-10 top-10 h-16 w-16 text-gold/30 animate-float" />
            <div className="relative">
              <h2 className="h-section max-w-xl text-white">{t.home.finalTitle}</h2>
              <p className="mt-4 max-w-xl text-lg text-white/75">{t.home.finalText}</p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Link href={L("/register")} className="btn btn-gold">
                  {t.cta.enroll}
                </Link>
                <Link href={L("/corporate#request")} className="btn btn-ghost-light">
                  {t.cta.corporate}
                </Link>
                <Link href={L("/contact")} className="btn btn-ghost-light">
                  {t.cta.contact}
                </Link>
              </div>
            </div>
          </Reveal>
          <Reveal delay={0.1} className="card flex flex-col justify-center p-10">
            <h2 className="text-2xl font-bold">{t.home.newsletterTitle}</h2>
            <p className="mt-3 text-slate">{t.home.newsletterText}</p>
            <div className="mt-6">
              <NewsletterForm locale={locale} t={t.newsletter} errors={t.forms.errors} />
            </div>
          </Reveal>
        </div>
      </section>
    </>
  );
}
