import type { Metadata } from "next";
import { isLocale, type Locale } from "@/lib/constants";
import { getDictionary } from "@/lib/i18n";
import { pageMeta } from "@/lib/seo";
import { ManageSettings } from "@/components/manage/ManageHome";

// Admin dashboard: the page is static; all data comes from the exam_* database functions after sign-in,
// and each function checks the member's permissions.
export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  return pageMeta({ locale, path: "/manage/settings", title: getDictionary(locale).exams.manage.settings.title, noindex: true });
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: l } = await params;
  const locale = l as Locale;
  return <ManageSettings locale={locale} labels={getDictionary(locale).exams} />;
}
