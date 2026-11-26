import type { Metadata } from "next";
import { isLocale, type Locale } from "@/lib/constants";
import { getDictionary } from "@/lib/i18n";
import { pageMeta } from "@/lib/seo";
import { AnalyticsPage } from "@/components/exams/AnalyticsPage";

// Exams platform (docs/exam-system): the page is static; all data comes from the exam_* database functions
// after sign-in, so nothing private is ever part of the published HTML.
export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  return pageMeta({ locale, path: "/exams/analytics", title: getDictionary(locale).exams.analytics.title, noindex: true });
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: l } = await params;
  const locale = l as Locale;
  const t = getDictionary(locale);
  return <AnalyticsPage locale={locale} labels={t.exams} homeLabel={t.common.breadcrumbHome} />;
}
