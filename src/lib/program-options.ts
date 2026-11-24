import "server-only";
import { db } from "./db";
import type { Locale } from "./constants";
import { getDictionary } from "./i18n";
import { formatDate, pick } from "./utils";
import { startOfToday } from "./queries";
import type { ProgramOption } from "@/components/forms/RegistrationForm";

/** Programs + their open upcoming sessions, shaped for the registration form */
export async function registrationOptions(locale: Locale): Promise<ProgramOption[]> {
  const t = getDictionary(locale);
  const programs = await db.program.findMany({
    where: { published: true, status: { not: "CLOSED" } },
    orderBy: [{ order: "asc" }],
    include: {
      sessions: {
        where: { published: true, startDate: { gte: startOfToday() }, status: { not: "CLOSED" } },
        orderBy: { startDate: "asc" },
        include: { _count: { select: { registrations: { where: { status: { not: "CANCELLED" } } } } } },
      },
    },
  });
  return programs.map((p) => ({
    id: p.id,
    title: pick(p, "title", locale),
    status: p.status,
    sessions: p.sessions.map((s) => {
      const left = s.seats == null ? null : Math.max(0, s.seats - s._count.registrations);
      const full = s.status === "FULL" || left === 0;
      const mode = (t.status.mode as Record<string, string>)[s.mode];
      return {
        id: s.id,
        label: `${formatDate(s.startDate, locale)} · ${mode}${full ? ` · ${t.status.session.FULL}` : left != null ? ` · ${left} ${t.programs.seatsLeft}` : ""}`,
        disabled: full,
      };
    }),
  }));
}
