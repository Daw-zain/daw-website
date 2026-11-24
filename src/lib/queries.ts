import "server-only";
import { cache } from "react";
import { db } from "./db";

const upcomingSessions = () => ({
  where: { published: true, startDate: { gte: startOfToday() } },
  orderBy: { startDate: "asc" as const },
});

export function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

export const getPrograms = cache(async () =>
  db.program.findMany({
    where: { published: true },
    orderBy: [{ order: "asc" }, { createdAt: "asc" }],
    include: { sessions: { ...upcomingSessions(), take: 1, select: { startDate: true } } },
  }),
);

export const getProgram = cache(async (slug: string) =>
  db.program.findFirst({
    where: { slug, published: true },
    include: {
      sessions: {
        ...upcomingSessions(),
        include: { _count: { select: { registrations: { where: { status: { not: "CANCELLED" } } } } } },
      },
    },
  }),
);

export const getServices = cache(async () =>
  db.consultingService.findMany({ where: { published: true }, orderBy: [{ order: "asc" }, { createdAt: "asc" }] }),
);

export const getUpcomingSessions = cache(async () =>
  db.courseSession.findMany({
    ...upcomingSessions(),
    where: { ...upcomingSessions().where, program: { published: true } },
    include: {
      program: { select: { slug: true, titleAr: true, titleEn: true, code: true, status: true } },
      _count: { select: { registrations: { where: { status: { not: "CANCELLED" } } } } },
    },
  }),
);

export const getCredentials = cache(async () => db.credential.findMany({ where: { published: true }, orderBy: [{ order: "asc" }] }));

export const getStats = cache(async () => db.stat.findMany({ where: { published: true }, orderBy: [{ order: "asc" }] }));

export const getTestimonials = cache(async () =>
  db.testimonial.findMany({ where: { published: true, consent: true }, orderBy: [{ order: "asc" }, { createdAt: "desc" }] }),
);

export const getFaqs = cache(async (scope: string) =>
  db.faq.findMany({ where: { published: true, scope }, orderBy: [{ order: "asc" }] }),
);

export const getResources = cache(async () =>
  db.resource.findMany({
    where: { published: true, publishedAt: { lte: new Date() } },
    orderBy: [{ featured: "desc" }, { publishedAt: "desc" }],
    select: {
      id: true,
      slug: true,
      type: true,
      category: true,
      titleAr: true,
      titleEn: true,
      excerptAr: true,
      excerptEn: true,
      coverImage: true,
      readMinutes: true,
      publishedAt: true,
      featured: true,
    },
  }),
);

export const getResource = cache(async (slug: string) =>
  db.resource.findFirst({ where: { slug, published: true, publishedAt: { lte: new Date() } } }),
);

/** seats left for a session (null = not announced) */
export function seatsLeft(s: { seats: number | null; _count: { registrations: number } }) {
  if (s.seats == null) return null;
  return Math.max(0, s.seats - s._count.registrations);
}
