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

export function personJsonLd(locale: Locale, opts: { image?: string; sameAs: string[] }) {
  return {
    "@context": "https://schema.org",
    "@type": "Person",
    "@id": siteUrl("/#person"),
    name: "Daw Zainelabideen",
    alternateName: "ضوء زين العابدين",
    jobTitle: locale === "ar" ? "مدرب ومستشار إدارة المشروعات" : "Project Management Trainer & Consultant",
    url: siteUrl(`/${locale}`),
    ...(opts.image ? { image: siteUrl(opts.image) } : {}),
    sameAs: opts.sameAs,
    alumniOf: [{ "@type": "CollegeOrUniversity", name: "University of Birmingham" }],
    hasCredential: [
      { "@type": "EducationalOccupationalCredential", credentialCategory: "Professional certification", name: "Project Management Professional (PMP)", recognizedBy: { "@type": "Organization", name: "Project Management Institute" } },
      { "@type": "EducationalOccupationalCredential", credentialCategory: "Professional certification", name: "PMI Risk Management Professional (PMI-RMP)", recognizedBy: { "@type": "Organization", name: "Project Management Institute" } },
      { "@type": "EducationalOccupationalCredential", credentialCategory: "Professional certification", name: "PMI Agile Certified Practitioner (PMI-ACP)", recognizedBy: { "@type": "Organization", name: "Project Management Institute" } },
      { "@type": "EducationalOccupationalCredential", credentialCategory: "degree", name: "Master's Degree in Engineering Project Management" },
      { "@type": "EducationalOccupationalCredential", credentialCategory: "degree", name: "BEng in Computer Engineering", recognizedBy: { "@type": "CollegeOrUniversity", name: "University of Birmingham" } },
    ],
    knowsAbout: ["Project Management", "Risk Management", "Agile", "PMO", "Project Governance", "PMP Exam Preparation"],
  };
}

export function serviceProviderJsonLd(locale: Locale, opts: { email?: string; phone?: string }) {
  return {
    "@context": "https://schema.org",
    "@type": "ProfessionalService",
    "@id": siteUrl("/#business"),
    name: locale === "ar" ? "ضوء زين العابدين – التدريب والاستشارات في إدارة المشروعات" : "Daw Zainelabideen – Project Management Training & Consulting",
    url: siteUrl(`/${locale}`),
    founder: { "@id": siteUrl("/#person") },
    areaServed: [{ "@type": "Country", name: "Libya" }, { "@type": "Place", name: "Middle East and North Africa" }],
    ...(opts.email ? { email: opts.email } : {}),
    ...(opts.phone ? { telephone: opts.phone } : {}),
  };
}

export function breadcrumbJsonLd(items: { name: string; path: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((it, i) => ({ "@type": "ListItem", position: i + 1, name: it.name, item: siteUrl(it.path) })),
  };
}
