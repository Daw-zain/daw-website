import type { Metadata } from "next";
import { isLocale, type Locale } from "@/lib/constants";
import { getDictionary } from "@/lib/i18n";
import { getSettings } from "@/lib/settings";
import { getCredentials } from "@/lib/queries";
import { pageMeta } from "@/lib/seo";
import { pick } from "@/lib/utils";
import { LogoPortrait } from "@/components/Logo";
import { PrintButton } from "@/components/PrintButton";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const t = getDictionary(locale);
  return pageMeta({ locale, path: "/cv", title: t.cv.title, description: t.about.intro });
}

/** Printable CV generated from the site data. "Print / Save as PDF" produces the PDF. An uploaded PDF (Admin → Settings → CV) takes priority on the site's buttons. */
export default async function CV({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: l } = await params;
  const locale = l as Locale;
  const t = getDictionary(locale);
  const [settings, creds] = await Promise.all([getSettings(), getCredentials()]);
  const contact = [settings.contactEmail, settings.phone, settings.linkedin].filter(Boolean);

  return (
    <section className="bg-mist py-10 print:bg-white print:py-0">
      <div className="container-x max-w-4xl">
        <div className="no-print mb-6 flex justify-end">
          <PrintButton label={t.cv.print} />
        </div>
        <article className="rounded-2xl bg-white p-5 shadow-card sm:p-10 print:rounded-none print:p-0 print:shadow-none">
          <header className="flex items-start justify-between gap-4 border-b-4 border-gold pb-6 sm:gap-6">
            <div className="min-w-0">
              <h1 className="text-2xl font-bold text-navy sm:text-3xl">{locale === "ar" ? "ضوء زين العابدين" : "Daw Zainelabideen"}</h1>
              <p className="mt-1 text-lg text-brand">{t.meta.tagline}</p>
              <p className="mt-1 text-sm text-slate" dir="ltr">
                PMP® · PMI-RMP® · PMI-ACP®
              </p>
              {contact.length > 0 && (
                <p className="mt-3 break-words text-sm text-slate" dir="ltr">
                  {contact.join("  ·  ")}
                </p>
              )}
            </div>
            <LogoPortrait className="h-12 w-12 shrink-0 sm:h-16 sm:w-16" />
          </header>

          <section className="mt-8">
            <h2 className="text-lg font-bold uppercase tracking-wide text-navy">{t.about.bioTitle}</h2>
            {t.about.bio.map((p, i) => (
              <p key={i} className="mt-3 leading-7 text-ink/90">
                {p}
              </p>
            ))}
          </section>

          <div className="mt-8 grid gap-8 md:grid-cols-2 print:grid-cols-2">
            <section>
              <h2 className="text-lg font-bold uppercase tracking-wide text-navy">{t.about.certsTitle}</h2>
              <ul className="mt-3 space-y-2">
                {creds
                  .filter((c) => c.kind === "PROFESSIONAL")
                  .map((c) => (
                    <li key={c.id}>
                      <p className="font-semibold">{pick(c, "title", locale)}</p>
                      <p className="text-sm text-slate">{pick(c, "issuer", locale)}</p>
                    </li>
                  ))}
              </ul>
            </section>
            <section>
              <h2 className="text-lg font-bold uppercase tracking-wide text-navy">{t.about.academicTitle}</h2>
              <ul className="mt-3 space-y-2">
                {creds
                  .filter((c) => c.kind === "ACADEMIC")
                  .map((c) => (
                    <li key={c.id}>
                      <p className="font-semibold">{pick(c, "title", locale)}</p>
                      <p className="text-sm text-slate">{[pick(c, "issuer", locale), c.year].filter(Boolean).join(" – ")}</p>
                    </li>
                  ))}
              </ul>
            </section>
          </div>

          <section className="mt-8">
            <h2 className="text-lg font-bold uppercase tracking-wide text-navy">{t.about.experienceTitle}</h2>
            <ul className="mt-3 space-y-3">
              {t.about.experience.map((e, i) => (
                <li key={i} className="grid gap-1 sm:grid-cols-[140px_1fr] sm:gap-4 print:grid-cols-[140px_1fr] print:gap-4">
                  <span className="text-sm font-semibold text-brand" dir="auto">
                    {e.period}
                  </span>
                  <span>
                    <span className="font-semibold">{e.title}</span>
                    <span className="block text-sm text-slate">{e.text}</span>
                  </span>
                </li>
              ))}
            </ul>
          </section>

          <section className="mt-8">
            <h2 className="text-lg font-bold uppercase tracking-wide text-navy">{t.about.domainsTitle}</h2>
            <p className="mt-3 leading-7">{t.about.domains.join(" · ")}</p>
          </section>
        </article>
      </div>
    </section>
  );
}
