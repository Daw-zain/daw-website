/** Site identity: the training & consulting site of Al Daleel Raqamee (www.aldaleel.ly). */
export const BRAND = {
  nameAr: "الدليل الرقمي",
  nameEn: "Al Daleel Raqamee",
  unitAr: "التدريب والاستشارات",
  unitEn: "Training & Consulting",
  /** full site name, e.g. in titles */
  siteAr: "الدليل الرقمي – التدريب والاستشارات",
  siteEn: "Al Daleel Raqamee – Training & Consulting",
  legalAr: "شركة الدليل الرقمي لتقنية المعلومات والنظم الجغرافية",
  legalEn: "Al Daleel Raqamee for IT & GIS",
  companyUrl: "https://www.aldaleel.ly",
  logo: "/images/brand/aldaleel-logo.png",
  logoWhite: "/images/brand/aldaleel-logo-white.png",
} as const;

export const brandName = (locale: string) => (locale === "ar" ? BRAND.nameAr : BRAND.nameEn);
export const siteName = (locale: string) => (locale === "ar" ? BRAND.siteAr : BRAND.siteEn);
