import type { Metadata } from "next";
import { isLocale, type Locale } from "@/lib/constants";
import { getDictionary } from "@/lib/i18n";
import { pageMeta } from "@/lib/seo";
import { SebPage } from "@/components/exams/Seb";

// Safe Exam Browser: device check for everyone signed in, the general switch for the super admin
export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  return pageMeta({ locale, path: "/exams/seb", title: getDictionary(locale).exams.seb.pageTitle, noindex: true });
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: l } = await params;
  const locale = l as Locale;
  const t = getDictionary(locale);
  return <SebPage locale={locale} labels={t.exams} homeLabel={t.common.breadcrumbHome} />;
}
