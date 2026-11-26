import { BRAND } from "./brand";
import type { Metadata } from "next";
import type { Locale } from "./constants";
import { getDictionary } from "./i18n";
import { siteUrl } from "./utils";

/**
 * Build page metadata with canonical URL + hreflang alternates for both languages.
 * `path` is the locale-less path, e.g. "/programs/pmp-exam-preparation".
 */
export function pageMeta({
  locale,
  path,
  title,
  description,
  image,
  type = "website",
  noindex = false,
}: {
  locale: Locale;
  path: string;
  title?: string;
  description?: string;
  image?: string | null;
  type?: "website" | "article";
  noindex?: boolean;
}): Metadata {
  const t = getDictionary(locale);
  const p = path === "/" ? "" : path;
  const url = siteUrl(`/${locale}${p}`);
  const fullTitle = title ? `${title} | ${t.meta.siteName}` : t.meta.defaultTitle;
  const desc = description || t.meta.defaultDescription;
  const images = image ? [{ url: image.startsWith("http") ? image : siteUrl(image) }] : undefined;
  return {
    title: fullTitle,
    description: desc,
    alternates: {
      canonical: url,
      languages: {
        ar: siteUrl(`/ar${p}`),
        en: siteUrl(`/en${p}`),
        "x-default": siteUrl(`/ar${p}`),
      },
    },
    openGraph: {
      type,
      url,
      title: fullTitle,
      description: desc,
      siteName: t.meta.siteName,
      locale: locale === "ar" ? "ar_LY" : "en_US",
      alternateLocale: locale === "ar" ? ["en_US"] : ["ar_LY"],
      ...(images ? { images } : {}),
    },
    twitter: { card: "summary_large_image", title: fullTitle, description: desc, ...(images ? { images } : {}) },
    robots: noindex ? { index: false, follow: true } : undefined,
  };
}

/** The company (parent organization) — details live on www.aldaleel.ly. */
export function organizationJsonLd(locale: Locale, opts: { sameAs: string[] }) {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    "@id": `${BRAND.companyUrl}/#organization`,
    name: locale === "ar" ? BRAND.legalAr : BRAND.legalEn,
    alternateName: [BRAND.nameAr, BRAND.nameEn, "AL DALEEL"],
    url: BRAND.companyUrl,
    logo: siteUrl(BRAND.logo),
    ...(opts.sameAs.length ? { sameAs: opts.sameAs } : {}),
  };
}

/** This site: the company's training & consulting service. */
export function serviceProviderJsonLd(locale: Locale, opts: { email?: string; phone?: string }) {
  return {
    "@context": "https://schema.org",
    "@type": "EducationalOrganization",
    "@id": siteUrl("/#training"),
    name: locale === "ar" ? BRAND.siteAr : BRAND.siteEn,
    url: siteUrl(`/${locale}`),
    logo: siteUrl(BRAND.logo),
    parentOrganization: { "@id": `${BRAND.companyUrl}/#organization` },
    areaServed: [{ "@type": "Country", name: "Libya" }],
    knowsAbout: ["Project Management", "Risk Management", "Agile", "PMO", "Project Governance", "PMP Exam Preparation"],
    ...(opts.email ? { email: opts.email } : {}),
    ...(opts.phone ? { telephone: opts.phone } : {}),
  };
}

/** schema.org reference to this training organization (for Course / Event / Article "provider") */
export const providerRef = (locale: Locale) => ({ "@type": "Organization", name: locale === "ar" ? BRAND.siteAr : BRAND.siteEn, url: siteUrl(`/${locale}`) });
export function breadcrumbJsonLd(items: { name: string; path: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((it, i) => ({ "@type": "ListItem", position: i + 1, name: it.name, item: siteUrl(it.path) })),
  };
}
