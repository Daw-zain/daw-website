import Link from "next/link";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { isLocale, type Locale } from "@/lib/constants";
import { getDictionary } from "@/lib/i18n";
import { getCurrentUser } from "@/lib/auth";
import { getSettings } from "@/lib/settings";
import { pageMeta } from "@/lib/seo";
import { AuthShell } from "@/components/AuthShell";
import { LoginForm } from "@/components/forms/AccountForms";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  return pageMeta({ locale, path: "/account/login", title: getDictionary(locale).account.loginTitle, noindex: true });
}

export default async function Login({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: l } = await params;
  const locale = l as Locale;
  const t = getDictionary(locale);
  if (await getCurrentUser()) redirect(`/${locale}/account`);
  const settings = await getSettings();
  return (
    <AuthShell
      locale={locale}
      t={t}
      mode="login"
      title={t.account.loginTitle}
      text={t.account.loginText}
      footer={
        <>
          {t.account.noAccount}{" "}
          <Link href={`/${locale}/account/register`} className="font-semibold text-brand hover:underline">
            {t.account.createAccount}
          </Link>
        </>
      }
    >
      <LoginForm locale={locale} a={t.account} f={t.forms} />
    </AuthShell>
  );
}