import Link from "next/link";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { isLocale, type Locale } from "@/lib/constants";
import { getDictionary } from "@/lib/i18n";
import { getCurrentUser } from "@/lib/auth";
import { pageMeta } from "@/lib/seo";
import { LoginForm } from "@/components/forms/AccountForms";
import { LogoPortrait } from "@/components/Logo";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  return pageMeta({ locale, path: "/account/login", title: getDictionary(locale).account.loginTitle, noindex: true });
}

export default async function Login({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ next?: string }> }) {
  const { locale: l } = await params;
  const { next } = await searchParams;
  const locale = l as Locale;
  const t = getDictionary(locale);
  if (await getCurrentUser()) redirect(`/${locale}/account`);
  return (
    <section className="grid min-h-[70vh] place-items-center bg-mist px-5 py-16">
      <div className="card w-full max-w-md p-8 sm:p-10">
        <LogoPortrait className="h-12 w-12" />
        <h1 className="mt-6 text-2xl font-bold">{t.account.loginTitle}</h1>
        <div className="mt-6">
          <LoginForm locale={locale} a={t.account} f={t.forms} next={next} />
        </div>
        <p className="mt-6 text-sm text-slate">
          {t.account.noAccount}{" "}
          <Link href={`/${locale}/account/register`} className="font-semibold text-brand hover:underline">
            {t.account.createAccount}
          </Link>
        </p>
      </div>
    </section>
  );
}
