import Link from "next/link";
import Image from "next/image";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isLocale, type Locale } from "@/lib/constants";
import { getDictionary } from "@/lib/i18n";
import { getResource, getResources } from "@/lib/queries";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { renderMarkdown } from "@/lib/markdown";
import { breadcrumbJsonLd, pageMeta } from "@/lib/seo";
import { formatDate, pick, siteUrl, youtubeEmbed } from "@/lib/utils";
import { JsonLd, ShareButtons, PageHero } from "@/components/ui";
import { ResourceCard } from "@/components/cards";
import { FavoriteButton } from "@/components/FavoriteButton";
import { withBase } from "@/lib/env-public";
import { Quiz, type QuizQuestion } from "@/components/Quiz";
import { DownloadIcon } from "@/components/Icons";
import { Reveal } from "@/components/motion";

type Props = { params: Promise<{ locale: string; slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, slug } = await params;
  if (!isLocale(locale)) return {};
  const r = await getResource(slug);
  if (!r) return {};
  return pageMeta({ locale, path: `/knowledge/${slug}`, title: pick(r, "title", locale), description: pick(r, "excerpt", locale), image: r.coverImage, type: "article" });
}

function parseQuiz(json: string | null, locale: Locale): QuizQuestion[] {
  if (!json) return [];
  try {
    const data = JSON.parse(json);
    const list = Array.isArray(data) ? data : data[locale] ?? data[locale === "ar" ? "en" : "ar"] ?? [];
    return list.filter((x: QuizQuestion) => x && typeof x.q === "string" && Array.isArray(x.options) && typeof x.answer === "number");
  } catch {
    return [];
  }
}

export default async function ResourcePage({ params }: Props) {
  const { locale: l, slug } = await params;
  const locale = l as Locale;
  const t = getDictionary(locale);
  const r = await getResource(slug);
  if (!r) notFound();
  const [user, all] = await Promise.all([getCurrentUser(), getResources()]);
  const fav = user ? await db.favorite.findUnique({ where: { userId_resourceId: { userId: user.id, resourceId: r.id } } }) : null;
  const L = (p: string) => `/${locale}${p}`;
  const title = pick(r, "title", locale);
  const url = siteUrl(L(`/knowledge/${slug}`));
  const embed = youtubeEmbed(r.videoUrl);
  const quiz = r.type === "QUIZ" ? parseQuiz(r.quizJson, locale) : [];
  const related = all.filter((x) => x.id !== r.id && x.category === r.category).slice(0, 3);

  return (
    <>
      <PageHero
        eyebrow={`${t.categories.resourceType[r.type as keyof typeof t.categories.resourceType] ?? ""} · ${t.categories.resource[r.category as keyof typeof t.categories.resource] ?? ""}`}
        title={title}
        text={pick(r, "excerpt", locale)}
        crumbs={[{ href: L(""), label: t.common.breadcrumbHome }, { href: L("/knowledge"), label: t.nav.knowledge }, { label: title }]}
      >
        <p className="mt-6 text-sm text-white/60">
          {formatDate(r.publishedAt, locale)}
          {r.readMinutes ? ` · ${r.readMinutes} ${t.common.minutesRead}` : ""}
        </p>
      </PageHero>
      <JsonLd
        data={[
          {
            "@context": "https://schema.org",
            "@type": r.type === "VIDEO" ? "VideoObject" : r.type === "QUIZ" ? "Quiz" : "Article",
            headline: title,
            name: title,
            description: pick(r, "excerpt", locale),
            inLanguage: locale,
            datePublished: r.publishedAt.toISOString(),
            dateModified: r.updatedAt.toISOString(),
            author: { "@type": "Person", name: "Daw Zainelabideen" },
            url,
            ...(r.coverImage ? { image: siteUrl(r.coverImage) } : {}),
            ...(r.type === "VIDEO" && r.videoUrl ? { contentUrl: r.videoUrl, uploadDate: r.publishedAt.toISOString(), thumbnailUrl: r.coverImage ? siteUrl(r.coverImage) : undefined } : {}),
          },
          breadcrumbJsonLd([{ name: t.common.breadcrumbHome, path: L("") }, { name: t.nav.knowledge, path: L("/knowledge") }, { name: title, path: L(`/knowledge/${slug}`) }]),
        ]}
      />

      <article className="py-14">
        <div className="container-x max-w-3xl">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line pb-6">
            <ShareButtons url={url} title={title} label={t.common.share} />
            <FavoriteButton id={r.id} locale={locale} initial={!!fav} labels={{ save: t.knowledge.save, saved: t.knowledge.saved, login: t.knowledge.loginToSave }} />
          </div>

          {r.coverImage && (
            <div className="relative mt-8 aspect-[16/8] overflow-hidden rounded-2xl">
              <Image src={r.coverImage} alt="" fill sizes="(min-width:768px) 768px, 100vw" className="object-cover" priority />
            </div>
          )}

          {embed && (
            <div className="mt-8 aspect-video overflow-hidden rounded-2xl bg-navy shadow-lift">
              <iframe src={embed} title={title} className="h-full w-full" allow="accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen" loading="lazy" />
            </div>
          )}
          {r.videoUrl && !embed && (
            <a href={r.videoUrl} target="_blank" rel="noopener noreferrer" className="btn btn-primary mt-8">
              {t.knowledge.watch}
            </a>
          )}

          <div className="prose-site mt-8" dangerouslySetInnerHTML={{ __html: renderMarkdown(pick(r, "body", locale)) }} />

          {r.fileUrl && (
            <Reveal className="card mt-8 flex flex-wrap items-center justify-between gap-4 bg-sky-50 p-6">
              <p className="font-semibold text-navy">{title}</p>
              <a href={withBase(r.fileUrl)} download className="btn btn-primary">
                <DownloadIcon className="h-5 w-5" />
                {t.knowledge.downloadTemplate}
              </a>
            </Reveal>
          )}

          {quiz.length > 0 && (
            <div className="mt-10">
              <Quiz questions={quiz} labels={{ check: t.knowledge.quizStart, score: t.knowledge.quizScore, retry: t.knowledge.quizRetry, correct: t.knowledge.correct, incorrect: t.knowledge.incorrect }} />
            </div>
          )}

          <div className="mt-14 rounded-2xl bg-navy p-8 text-white">
            <p className="text-xl font-bold text-white">{t.home.finalTitle}</p>
            <div className="mt-5 flex flex-wrap gap-3">
              <Link href={L("/programs")} className="btn btn-gold">
                {t.cta.explore}
              </Link>
              <Link href={L("/consulting#request")} className="btn btn-ghost-light">
                {t.cta.consult}
              </Link>
            </div>
          </div>
        </div>
      </article>

      {related.length > 0 && (
        <section className="bg-mist py-14">
          <div className="container-x">
            <h2 className="text-2xl font-bold">{t.knowledge.related}</h2>
            <div className="mt-8 grid gap-6 md:grid-cols-3">
              {related.map((x) => (
                <ResourceCard key={x.id} r={x} locale={locale} t={t} />
              ))}
            </div>
          </div>
        </section>
      )}
    </>
  );
}
