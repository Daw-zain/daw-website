import Link from "next/link";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { isLocale, type Locale } from "@/lib/constants";
import { getDictionary } from "@/lib/i18n";
import { getCurrentUser } from "@/lib/auth";
import { pageMeta } from "@/lib/seo";
import { RegisterForm } from "@/components/forms/AccountForms";
import { LogoPortrait } from "@/components/Logo";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  return pageMeta({ locale, path: "/account/register", title: getDictionary(locale).account.registerTitle, noindex: true });
}

export default async function Register({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: l } = await params;
  const locale = l as Locale;
  const t = getDictionary(locale);
  if (await getCurrentUser()) redirect(`/${locale}/account`);
  return (
    <section className="grid min-h-[70vh] place-items-center bg-mist px-5 py-16">
      <div className="card w-full max-w-md p-8 sm:p-10">
        <LogoPortrait className="h-12 w-12" />
        <h1 className="mt-6 text-2xl font-bold">{t.account.registerTitle}</h1>
        <div className="mt-6">
          <RegisterForm locale={locale} a={t.account} f={t.forms} />
        </div>
        <p className="mt-6 text-sm text-slate">
          {t.account.haveAccount}{" "}
          <Link href={`/${locale}/account/login`} className="font-semibold text-brand hover:underline">
            {t.account.signIn}
          </Link>
        </p>
      </div>
    </section>
  );
}
