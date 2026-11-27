import type { Metadata } from "next";
import { isLocale, type Locale } from "@/lib/constants";
import { getDictionary } from "@/lib/i18n";
import { pageMeta } from "@/lib/seo";
import { ManageUsers } from "@/components/manage/ManageUsers";

// Admin dashboard: the page is static; all data comes from the exam_* database functions after sign-in,
// and each function checks the member's permissions.
export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  return pageMeta({ locale, path: "/manage/users", title: getDictionary(locale).exams.manage.users.title, noindex: true });
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: l } = await params;
  const locale = l as Locale;
  return <ManageUsers locale={locale} labels={getDictionary(locale).exams} />;
}
