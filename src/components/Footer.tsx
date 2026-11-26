import Link from "next/link";
import type { Dictionary } from "@/dictionaries/en";
import type { Locale } from "@/lib/constants";
import type { Settings } from "@/lib/settings";
import { BRAND } from "@/lib/brand";
import { Logo } from "./Logo";
import { NewsletterForm } from "./forms/NewsletterForm";
import { FacebookIcon, LinkedInIcon, MailIcon, PhoneIcon, PinIcon, WhatsAppIcon, YouTubeIcon } from "./Icons";
import { whatsappLink } from "@/lib/utils";

export function Footer({ locale, t, settings, programs }: { locale: Locale; t: Dictionary; settings: Settings; programs: { slug: string; title: string }[] }) {
  const L = (p: string) => `/${locale}${p}`;
  const wa = whatsappLink(settings.whatsapp);
  const address = locale === "ar" ? settings.addressAr : settings.addressEn;
  const links = [
    { href: L("/about"), label: t.nav.about },
    { href: L("/programs"), label: t.nav.programs },
    { href: L("/consulting"), label: t.nav.consulting },
    { href: L("/corporate"), label: t.nav.corporate },
    { href: L("/knowledge"), label: t.nav.knowledge },
    { href: L("/calendar"), label: t.nav.calendar },
    { href: L("/contact"), label: t.nav.contact },
  ];
  const socials = [
    settings.linkedin && { href: settings.linkedin, label: "LinkedIn", Icon: LinkedInIcon },
    settings.facebook && { href: settings.facebook, label: "Facebook", Icon: FacebookIcon },
    settings.youtube && { href: settings.youtube, label: "YouTube", Icon: YouTubeIcon },
    wa && { href: wa, label: "WhatsApp", Icon: WhatsAppIcon },
  ].filter(Boolean) as { href: string; label: string; Icon: typeof LinkedInIcon }[];

  return (
    <footer className="no-print relative overflow-hidden bg-navy-900 text-white/80">
      <div className="grid-bg pointer-events-none absolute inset-0 opacity-50" aria-hidden="true" />
      <div className="container-x relative">
        <div className="grid gap-10 border-b border-white/10 py-14 md:grid-cols-2 lg:grid-cols-12">
          <div className="lg:col-span-4">
            <Logo locale={locale} light />
            <p className="mt-5 max-w-sm text-[15px] leading-7 text-white/70">{t.footer.about}</p>
            {socials.length > 0 && (
              <ul className="mt-6 flex gap-2">
                {socials.map(({ href, label, Icon }) => (
                  <li key={label}>
                    <a href={href} target="_blank" rel="noopener noreferrer" aria-label={label} className="grid h-10 w-10 place-items-center rounded-xl border border-white/15 text-white/80 transition hover:-translate-y-0.5 hover:border-gold hover:text-gold">
                      <Icon className="h-5 w-5" />
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="lg:col-span-2">
            <h2 className="text-sm font-bold uppercase tracking-wider text-white">{t.footer.quickLinks}</h2>
            <ul className="mt-4 space-y-2.5 text-[15px]">
              {links.map((l) => (
                <li key={l.href}>
                  <Link href={l.href} className="transition hover:text-gold">
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
          <div className="lg:col-span-3">
            <h2 className="text-sm font-bold uppercase tracking-wider text-white">{t.footer.programs}</h2>
            <ul className="mt-4 space-y-2.5 text-[15px]">
              {programs.slice(0, 7).map((p) => (
                <li key={p.slug}>
                  <Link href={L(`/programs/${p.slug}`)} className="transition hover:text-gold">
                    {p.title}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
          <div className="lg:col-span-3">
            <h2 className="text-sm font-bold uppercase tracking-wider text-white">{t.footer.contact}</h2>
            <ul className="mt-4 space-y-3 text-[15px]">
              {settings.contactEmail && (
                <li className="flex items-center gap-2.5">
                  <MailIcon className="h-4 w-4 text-gold" />
                  <a href={`mailto:${settings.contactEmail}`} className="hover:text-gold" dir="ltr">
                    {settings.contactEmail}
                  </a>
                </li>
              )}
              {settings.phone && (
                <li className="flex items-center gap-2.5">
                  <PhoneIcon className="h-4 w-4 text-gold" />
                  <a href={`tel:${settings.phone.replace(/\s/g, "")}`} className="hover:text-gold" dir="ltr">
                    {settings.phone}
                  </a>
                </li>
              )}
              {address && (
                <li className="flex items-start gap-2.5">
                  <PinIcon className="mt-1 h-4 w-4 text-gold" />
                  <span>{address}</span>
                </li>
              )}
              <li>
                <a href={BRAND.companyUrl} target="_blank" rel="noopener" className="hover:text-gold">
                  {t.footer.company} ↗
                </a>
              </li>
              <li>
                <Link href={L("/contact")} className="font-semibold text-gold hover:underline">
                  {t.cta.contact} →
                </Link>
              </li>
            </ul>
            <h2 className="mt-8 text-sm font-bold uppercase tracking-wider text-white">{t.footer.newsletter}</h2>
            <div className="mt-3">
              <NewsletterForm locale={locale} t={t.newsletter} errors={t.forms.errors} dark />
            </div>
          </div>
        </div>
        <div className="flex flex-col gap-4 py-8 text-sm text-white/55 md:flex-row md:items-start md:justify-between">
          <p>
            © {new Date().getFullYear()} {locale === "ar" ? BRAND.legalAr : BRAND.legalEn}. {t.footer.rights} ·{" "}
            <Link href={L("/privacy")} className="hover:text-gold">
              {t.footer.privacy}
            </Link>
          </p>
          <p className="max-w-2xl text-xs leading-6 text-white/45">{t.footer.disclaimer}</p>
        </div>
      </div>
    </footer>
  );
}
