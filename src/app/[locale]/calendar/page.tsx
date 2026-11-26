import Link from "next/link";
import type { Metadata } from "next";
import { isLocale, type Locale } from "@/lib/constants";
import { getDictionary } from "@/lib/i18n";
import { getUpcomingSessions, seatsLeft } from "@/lib/queries";
import { breadcrumbJsonLd, pageMeta, providerRef } from "@/lib/seo";
import { pick } from "@/lib/utils";
import { PageHero, JsonLd, EmptyState } from "@/components/ui";
import { CalendarView, type CalSession } from "@/components/CalendarView";
import { NewsletterForm } from "@/components/forms/NewsletterForm";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const t = getDictionary(locale);
  return pageMeta({ locale, path: "/calendar", title: t.calendar.title, description: t.calendar.intro });
}

export default async function CalendarPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: l } = await params;
  const locale = l as Locale;
  const t = getDictionary(locale);
  const sessions = await getUpcomingSessions();
  const L = (p: string) => `/${locale}${p}`;

  const data: CalSession[] = sessions.map((s) => {
    const left = seatsLeft(s);
    const status = (s.status === "OPEN" && left === 0 ? "FULL" : s.status) as CalSession["status"];
    return {
      id: s.id,
      start: s.startDate.toISOString(),
      end: s.endDate?.toISOString() ?? null,
      programSlug: s.program.slug,
      programTitle: pick(s.program, "title", locale),
      code: s.program.code,
      mode: s.mode,
      modeLabel: (t.status.mode as Record<string, string>)[s.mode],
      schedule: pick(s, "schedule", locale),
      location: pick(s, "location", locale),
      seatsLabel: left == null ? t.common.tba : `${left}`,
      status,
      statusLabel: (t.status.session as Record<string, string>)[status],
    };
  });

  return (
    <>
      <PageHero title={t.calendar.title} text={t.calendar.intro} crumbs={[{ href: L(""), label: t.common.breadcrumbHome }, { label: t.nav.calendar }]} />
      <JsonLd
        data={[
          breadcrumbJsonLd([{ name: t.common.breadcrumbHome, path: L("") }, { name: t.nav.calendar, path: L("/calendar") }]),
          ...sessions.map((s) => ({
            "@context": "https://schema.org",
            "@type": "EducationEvent",
            name: pick(s.program, "title", locale),
            startDate: s.startDate.toISOString(),
            ...(s.endDate ? { endDate: s.endDate.toISOString() } : {}),
            eventAttendanceMode:
              s.mode === "ONLINE" ? "https://schema.org/OnlineEventAttendanceMode" : s.mode === "HYBRID" ? "https://schema.org/MixedEventAttendanceMode" : "https://schema.org/OfflineEventAttendanceMode",
            eventStatus: "https://schema.org/EventScheduled",
            location: s.mode === "ONLINE" ? { "@type": "VirtualLocation", url: L(`/programs/${s.program.slug}`) } : { "@type": "Place", name: pick(s, "location", locale) || "Libya" },
            organizer: providerRef(locale),
          })),
        ]}
      />
      <section className="py-14">
        <div className="container-x">
          {data.length === 0 ? (
            <EmptyState text={t.calendar.empty}>
              <Link href={L("/register")} className="btn btn-primary">
                {t.cta.registerInterest}
              </Link>
              <Link href={L("/programs")} className="btn btn-outline">
                {t.cta.explore}
              </Link>
            </EmptyState>
          ) : (
            <CalendarView
              sessions={data}
              locale={locale}
              labels={{
                listView: t.calendar.listView,
                calendarView: t.calendar.calendarView,
                date: t.calendar.date,
                program: t.calendar.program,
                mode: t.calendar.mode,
                seats: t.calendar.seats,
                status: t.calendar.status,
                prev: t.calendar.prev,
                next: t.calendar.next,
                today: t.calendar.today,
                enroll: t.cta.enroll,
                weekdays: t.calendar.weekdays,
              }}
            />
          )}
          <div className="card mx-auto mt-14 max-w-2xl p-8 text-center">
            <h2 className="text-xl font-bold">{t.home.newsletterTitle}</h2>
            <p className="mt-2 text-slate">{t.home.newsletterText}</p>
            <div className="mt-5">
              <NewsletterForm locale={locale} t={t.newsletter} errors={t.forms.errors} />
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
