import "../globals.css";
import type { Metadata, Viewport } from "next";
import Script from "next/script";
import { notFound } from "next/navigation";
import { alexandria, inter, plexArabic } from "../fonts";
import { isLocale } from "@/lib/constants";
import { dir, getDictionary } from "@/lib/i18n";
import { getSettings } from "@/lib/settings";
import { getPrograms } from "@/lib/queries";
import { getCurrentUser } from "@/lib/auth";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { MotionProvider } from "@/components/motion";
import { JsonLd, WhatsAppFloat } from "@/components/ui";
import { organizationJsonLd, pageMeta, serviceProviderJsonLd } from "@/lib/seo";
import { BRAND } from "@/lib/brand";
import { siteUrl } from "@/lib/utils";

// Pages read live data (admin edits appear immediately), so render on request.
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  return {
    metadataBase: new URL(siteUrl()),
    ...pageMeta({ locale, path: "/" }),
    applicationName: BRAND.siteEn,
    authors: [{ name: BRAND.legalEn, url: BRAND.companyUrl }],
    keywords:
      locale === "ar"
        ? ["دورة PMP ليبيا", "تدريب إدارة المشروعات", "مدرب PMP", "دورة إدارة المخاطر", "إدارة المشروعات", "PMI-RMP", "PMI-ACP", "استشارات إدارة المشروعات"]
        : ["PMP Training Libya", "PMP Course Tripoli", "PMP Exam Preparation Arabic", "RMP Training", "PMI-ACP Training", "Project Management Consultant Libya"],
  };
}

export const viewport: Viewport = {
  themeColor: "#06152A",
  width: "device-width",
  initialScale: 1,
};

export default async function LocaleLayout({ children, params }: { children: React.ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const t = getDictionary(locale);
  const [settings, programs, user] = await Promise.all([getSettings(), getPrograms(), getCurrentUser()]);
  const gaId = process.env.NEXT_PUBLIC_GA_ID;
  const sameAs = [settings.linkedin, settings.facebook, settings.youtube].filter(Boolean);

  return (
    <html lang={locale} dir={dir(locale)} className={`${inter.variable} ${plexArabic.variable} ${alexandria.variable}`}>
      <body className="flex min-h-screen flex-col">
        <MotionProvider>
          <Header locale={locale} t={{ nav: t.nav, meta: t.meta }} signedIn={!!user} />
          <main id="main" className="flex-1">
            {children}
          </main>
          <Footer locale={locale} t={t} settings={settings} programs={programs.map((p) => ({ slug: p.slug, title: locale === "ar" ? p.titleAr : p.titleEn }))} />
          <WhatsAppFloat number={settings.whatsapp} text={locale === "ar" ? settings.whatsappMessageAr : settings.whatsappMessageEn} label={t.common.sendInquiry} />
        </MotionProvider>
        <JsonLd data={[organizationJsonLd(locale, { sameAs }), serviceProviderJsonLd(locale, { email: settings.contactEmail, phone: settings.phone })]} />
        {gaId && (
          <>
            <Script src={`https://www.googletagmanager.com/gtag/js?id=${gaId}`} strategy="afterInteractive" />
            <Script id="ga" strategy="afterInteractive">{`window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${gaId}',{anonymize_ip:true});`}</Script>
          </>
        )}
      </body>
    </html>
  );
}
