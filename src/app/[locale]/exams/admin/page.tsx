import type { Metadata } from "next";
import { isLocale, type Locale } from "@/lib/constants";
import { getDictionary } from "@/lib/i18n";
import { pageMeta } from "@/lib/seo";
import { ManageRedirect } from "@/components/manage/ManageRedirect";

// "Members & permissions" moved into the admin dashboard (LMS-1); old links keep working.
export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  return pageMeta({ locale, path: "/exams/admin", title: getDictionary(locale).exams.manage.users.title, noindex: true });
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: l } = await params;
  return <ManageRedirect to={`/${l as Locale}/manage/users/`} />;
}
