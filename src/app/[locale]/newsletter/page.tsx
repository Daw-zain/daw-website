import Link from "next/link";
import type { Metadata } from "next";
import { isLocale, type Locale } from "@/lib/constants";
import { getDictionary } from "@/lib/i18n";
import { db } from "@/lib/db";
import { pageMeta } from "@/lib/seo";
import { PageHero } from "@/components/ui";
import { NewsletterForm } from "@/components/forms/NewsletterForm";
import { CheckIcon } from "@/components/Icons";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  return pageMeta({ locale, path: "/newsletter", title: getDictionary(locale).newsletter.pageTitle, noindex: true });
}

export default async function Newsletter({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ action?: string; token?: string }> }) {
  const { locale: l } = await params;
  const { action, token } = await searchParams;
  const locale = l as Locale;
  const t = getDictionary(locale);

  let message: string | null = null;
  let ok = false;
  if (token && /^[a-f0-9]{48}$/.test(token) && (action === "confirm" || action === "unsubscribe")) {
    const sub = await db.subscriber.findUnique({ where: { token } });
    if (sub) {
      if (action === "confirm") {
        await db.subscriber.update({ where: { id: sub.id }, data: { confirmedAt: sub.confirmedAt ?? new Date(), unsubscribedAt: null } });
        message = t.newsletter.confirmed;
      } else {
        await db.subscriber.update({ where: { id: sub.id }, data: { unsubscribedAt: new Date() } });
        message = t.newsletter.unsubscribed;
      }
      ok = true;
    } else message = t.newsletter.invalid;
  } else if (action) message = t.newsletter.invalid;

  return (
    <>
      <PageHero title={t.newsletter.pageTitle} text={t.home.newsletterText} />
      <section className="py-16">
        <div className="container-x max-w-xl">
          {message && (
            <div className={`mb-8 flex items-center gap-3 rounded-2xl p-5 ${ok ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-800"}`} role="status">
              {ok && <CheckIcon className="h-6 w-6 shrink-0" />}
              <p className="font-semibold">{message}</p>
            </div>
          )}
          {!(ok && action === "confirm") && <NewsletterForm locale={locale} t={t.newsletter} errors={t.forms.errors} />}
          <Link href={`/${locale}`} className="mt-8 inline-block font-semibold text-brand hover:underline">
            {t.notFound.home}
          </Link>
        </div>
      </section>
    </>
  );
}
