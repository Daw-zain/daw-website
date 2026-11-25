import Link from "next/link";
import type { Metadata } from "next";
import { isLocale, type Locale } from "@/lib/constants";
import { getDictionary } from "@/lib/i18n";
import { pageMeta } from "@/lib/seo";
import { PageHero } from "@/components/ui";
import { NewsletterStatus } from "@/components/NewsletterStatus";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  return pageMeta({ locale, path: "/newsletter", title: getDictionary(locale).newsletter.pageTitle, noindex: true });
}

export default async function Newsletter({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: l } = await params;
  const locale = l as Locale;
  const t = getDictionary(locale);

  return (
    <>
      <PageHero title={t.newsletter.pageTitle} text={t.home.newsletterText} />
      <section className="py-16">
        <div className="container-x max-w-xl">
          <NewsletterStatus locale={locale} t={t.newsletter} errors={t.forms.errors} />
          <Link href={`/${locale}`} className="mt-8 inline-block font-semibold text-brand hover:underline">
            {t.notFound.home}
          </Link>
        </div>
      </section>
    </>
  );
}
