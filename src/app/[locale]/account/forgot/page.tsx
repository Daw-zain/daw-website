import Link from "next/link";
import type { Metadata } from "next";
import { isLocale, type Locale } from "@/lib/constants";
import { getDictionary } from "@/lib/i18n";
import { getSettings } from "@/lib/settings";
import { pageMeta } from "@/lib/seo";
import { AuthShell } from "@/components/AuthShell";
import { ForgotForm } from "@/components/forms/AccountForms";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  return pageMeta({ locale, path: "/account/forgot", title: getDictionary(locale).account.forgotTitle, noindex: true });
}

export default async function Forgot({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: l } = await params;
  const locale = l as Locale;
  const t = getDictionary(locale);
  const settings = await getSettings();
  return (
    <AuthShell
      locale={locale}
      t={t}
      mode="forgot"
      title={t.account.forgotTitle}
      text={t.account.forgotText}
      partnerLogo={settings.partnerLogo || undefined}
      footer={
        <Link href={`/${locale}/account/login`} className="font-semibold text-brand hover:underline">
          {t.account.backToLogin}
        </Link>
      }
    >
      <ForgotForm locale={locale} a={t.account} f={t.forms} />
    </AuthShell>
  );
}