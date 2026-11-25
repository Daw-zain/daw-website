import type { Metadata } from "next";
import { isLocale, type Locale } from "@/lib/constants";
import { getDictionary } from "@/lib/i18n";
import { getSettings } from "@/lib/settings";
import { getPrograms, getServices } from "@/lib/queries";
import { breadcrumbJsonLd, pageMeta } from "@/lib/seo";
import { pick, whatsappLink } from "@/lib/utils";
import { PageHero, JsonLd } from "@/components/ui";
import { Reveal } from "@/components/motion";
import { ContactTabs } from "@/components/ContactTabs";
import { ContactForm } from "@/components/forms/ContactForm";
import { ConsultationForm } from "@/components/forms/ConsultationForm";
import { CorporateForm } from "@/components/forms/CorporateForm";
import { LinkedInIcon, MailIcon, PhoneIcon, PinIcon, WhatsAppIcon } from "@/components/Icons";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const t = getDictionary(locale);
  return pageMeta({ locale, path: "/contact", title: t.contact.title, description: t.contact.intro });
}

export default async function Contact({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: l } = await params;
  const locale = l as Locale;
  const t = getDictionary(locale);
  const [settings, services, programs] = await Promise.all([getSettings(), getServices(), getPrograms()]);
  const L = (p: string) => `/${locale}${p}`;
  const wa = whatsappLink(settings.whatsapp, locale === "ar" ? settings.whatsappMessageAr : settings.whatsappMessageEn);
  const address = pick(settings as unknown as Record<string, string>, "address", locale);

  const details = [
    settings.contactEmail && { Icon: MailIcon, label: t.contact.email, value: settings.contactEmail, href: `mailto:${settings.contactEmail}`, ltr: true },
    settings.phone && { Icon: PhoneIcon, label: t.contact.phone, value: settings.phone, href: `tel:${settings.phone.replace(/\s/g, "")}`, ltr: true },
    wa && { Icon: WhatsAppIcon, label: t.contact.whatsapp, value: settings.whatsapp, href: wa, ltr: true },
    settings.linkedin && { Icon: LinkedInIcon, label: t.contact.linkedin, value: "LinkedIn", href: settings.linkedin, ltr: true },
    address && { Icon: PinIcon, label: t.contact.location, value: address, href: settings.mapUrl || undefined, ltr: false },
  ].filter(Boolean) as { Icon: typeof MailIcon; label: string; value: string; href?: string; ltr: boolean }[];

  return (
    <>
      <PageHero title={t.contact.title} text={t.contact.intro} crumbs={[{ href: L(""), label: t.common.breadcrumbHome }, { label: t.nav.contact }]} />
      <JsonLd data={breadcrumbJsonLd([{ name: t.common.breadcrumbHome, path: L("") }, { name: t.nav.contact, path: L("/contact") }])} />
      <section className="py-16">
        <div className="container-x grid gap-10 lg:grid-cols-[1fr_1.7fr]">
          <Reveal className="space-y-4">
            <h2 className="text-2xl font-bold">{t.contact.details}</h2>
            {details.length === 0 ? (
              <p className="text-slate">{t.contact.intro}</p>
            ) : (
              <ul className="space-y-3">
                {details.map(({ Icon, label, value, href, ltr }) => (
                  <li key={label}>
                    <a
                      href={href}
                      {...(href?.startsWith("http") ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                      className="card card-hover flex items-center gap-4 p-5"
                    >
                      <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-sky text-brand">
                        <Icon className="h-5 w-5" />
                      </span>
                      <span>
                        <span className="block text-sm text-slate">{label}</span>
                        <span className="block font-semibold text-navy" dir={ltr ? "ltr" : undefined}>
                          {value}
                        </span>
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            )}
            {settings.mapUrl && settings.mapUrl.includes("/maps/embed") && (
              <iframe src={settings.mapUrl} title={t.contact.location} className="mt-4 h-64 w-full rounded-2xl border border-line" loading="lazy" referrerPolicy="no-referrer-when-downgrade" />
            )}
          </Reveal>
          <Reveal delay={0.1} className="card p-6 sm:p-10">
            <ContactTabs
              keys={["message", "consultation", "corporate"]}
              tabs={[
                { label: t.contact.tabs.message, content: <ContactForm locale={locale} t={t.forms} /> },
                {
                  label: t.contact.tabs.consultation,
                  content: <ConsultationForm locale={locale} t={t.forms} services={services.map((s) => ({ id: s.id, slug: s.slug, title: pick(s, "title", locale) }))} methods={t.categories.contactMethod} />,
                },
                {
                  label: t.contact.tabs.corporate,
                  content: (
                    <CorporateForm locale={locale} t={t.forms} sectors={t.categories.sector} modes={t.status.mode} programs={programs.map((p) => ({ value: p.titleEn, slug: p.slug, label: pick(p, "title", locale) }))} />
                  ),
                },
              ]}
            />
          </Reveal>
        </div>
      </section>
    </>
  );
}
