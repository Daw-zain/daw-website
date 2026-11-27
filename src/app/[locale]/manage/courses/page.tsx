import type { Metadata } from "next";
import { isLocale, type Locale } from "@/lib/constants";
import { getDictionary } from "@/lib/i18n";
import { pageMeta } from "@/lib/seo";
import { ManageCourses } from "@/components/manage/ManageCourses";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  return pageMeta({ locale, path: "/manage/courses", title: getDictionary(locale).exams.manage.courses.title, noindex: true });
}

// Static page: all data comes from the database after sign-in, and every function checks permissions.
export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: l } = await params;
  const locale = l as Locale;
  return <ManageCourses locale={locale} labels={getDictionary(locale).exams} />;
}
