import type { MetadataRoute } from "next";
import { db } from "@/lib/db";
import { siteUrl } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [programs, services, resources] = await Promise.all([
    db.program.findMany({ where: { published: true }, select: { slug: true, updatedAt: true } }),
    db.consultingService.findMany({ where: { published: true }, select: { slug: true, updatedAt: true } }),
    db.resource.findMany({ where: { published: true, publishedAt: { lte: new Date() } }, select: { slug: true, updatedAt: true } }),
  ]);

  const entry = (path: string, lastModified?: Date, priority = 0.7): MetadataRoute.Sitemap =>
    (["ar", "en"] as const).map((l) => ({
      url: siteUrl(`/${l}${path}`),
      lastModified: lastModified ?? new Date(),
      priority,
      alternates: { languages: { ar: siteUrl(`/ar${path}`), en: siteUrl(`/en${path}`) } },
    }));

  return [
    ...entry("", undefined, 1),
    ...["/about", "/programs", "/consulting", "/corporate", "/knowledge", "/calendar", "/credentials", "/contact", "/register", "/cv", "/privacy"].flatMap((p) => entry(p, undefined, 0.8)),
    ...programs.flatMap((p) => entry(`/programs/${p.slug}`, p.updatedAt, 0.9)),
    ...services.flatMap((s) => entry(`/consulting/${s.slug}`, s.updatedAt, 0.7)),
    ...resources.flatMap((r) => entry(`/knowledge/${r.slug}`, r.updatedAt, 0.6)),
  ];
}
