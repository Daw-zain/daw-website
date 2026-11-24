"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowIcon, CalendarIcon, LayersIcon } from "./Icons";
import { cn } from "@/lib/utils";

export type CalSession = {
  id: string;
  start: string; // ISO
  end: string | null;
  programSlug: string;
  programTitle: string;
  code: string | null;
  mode: string;
  modeLabel: string;
  schedule: string;
  location: string;
  seatsLabel: string;
  status: "OPEN" | "FULL" | "CLOSED";
  statusLabel: string;
};

type Labels = {
  listView: string;
  calendarView: string;
  date: string;
  program: string;
  mode: string;
  seats: string;
  status: string;
  prev: string;
  next: string;
  today: string;
  enroll: string;
  weekdays: string[];
};

const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

export function CalendarView({ sessions, locale, labels }: { sessions: CalSession[]; locale: string; labels: Labels }) {
  const [view, setView] = useState<"list" | "calendar">("list");
  const first = sessions[0] ? new Date(sessions[0].start) : new Date();
  const [cursor, setCursor] = useState(new Date(first.getFullYear(), first.getMonth(), 1));
  const fmt = useMemo(() => new Intl.DateTimeFormat(locale === "ar" ? "ar-LY-u-nu-latn" : "en-GB", { day: "numeric", month: "long", year: "numeric" }), [locale]);
  const monthFmt = useMemo(() => new Intl.DateTimeFormat(locale === "ar" ? "ar-LY-u-nu-latn" : "en-GB", { month: "long", year: "numeric" }), [locale]);

  const byDay = useMemo(() => {
    const m = new Map<string, CalSession[]>();
    for (const s of sessions) {
      const start = new Date(s.start);
      const end = s.end ? new Date(s.end) : start;
      for (let d = new Date(start.getFullYear(), start.getMonth(), start.getDate()); d <= end; d.setDate(d.getDate() + 1)) {
        const k = dayKey(d);
        m.set(k, [...(m.get(k) ?? []), s]);
        if (m.size > 2000) break;
      }
    }
    return m;
  }, [sessions]);

  const days = useMemo(() => {
    const y = cursor.getFullYear();
    const mo = cursor.getMonth();
    const startPad = new Date(y, mo, 1).getDay();
    const count = new Date(y, mo + 1, 0).getDate();
    const cells: (Date | null)[] = Array.from({ length: startPad }, () => null);
    for (let i = 1; i <= count; i++) cells.push(new Date(y, mo, i));
    while (cells.length % 7) cells.push(null);
    return cells;
  }, [cursor]);

  const today = dayKey(new Date());
  const tab = (v: "list" | "calendar", label: string, Icon: typeof CalendarIcon) => (
    <button
      type="button"
      role="tab"
      aria-selected={view === v}
      onClick={() => setView(v)}
      className={cn("relative inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition", view === v ? "text-white" : "text-navy hover:text-brand")}
    >
      {view === v && <motion.span layoutId="cal-tab" className="absolute inset-0 rounded-lg bg-navy" transition={{ type: "spring", stiffness: 400, damping: 32 }} />}
      <Icon className="relative h-4 w-4" />
      <span className="relative">{label}</span>
    </button>
  );

  return (
    <div>
      <div role="tablist" className="inline-flex rounded-xl border border-line bg-white p-1">
        {tab("list", labels.listView, LayersIcon)}
        {tab("calendar", labels.calendarView, CalendarIcon)}
      </div>

      <AnimatePresence mode="wait">
        {view === "list" ? (
          <motion.div key="list" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} className="mt-6 overflow-hidden rounded-2xl border border-line bg-white">
            <table className="w-full text-start text-[15px]">
              <thead className="hidden bg-mist text-sm text-slate md:table-header-group">
                <tr>
                  <th className="px-5 py-3 text-start font-semibold">{labels.date}</th>
                  <th className="px-5 py-3 text-start font-semibold">{labels.program}</th>
                  <th className="px-5 py-3 text-start font-semibold">{labels.mode}</th>
                  <th className="px-5 py-3 text-start font-semibold">{labels.seats}</th>
                  <th className="px-5 py-3 text-start font-semibold">{labels.status}</th>
                  <th className="px-5 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {sessions.map((s) => (
                  <tr key={s.id} className="grid gap-1 p-5 transition hover:bg-sky-50/60 md:table-row md:p-0">
                    <td className="font-semibold text-navy md:px-5 md:py-4">
                      {fmt.format(new Date(s.start))}
                      {s.end ? <span className="block text-xs font-normal text-slate">→ {fmt.format(new Date(s.end))}</span> : null}
                    </td>
                    <td className="md:px-5 md:py-4">
                      <Link href={`/${locale}/programs/${s.programSlug}`} className="font-semibold text-brand hover:underline">
                        {s.programTitle}
                      </Link>
                      {s.schedule && <span className="block text-xs text-slate">{s.schedule}</span>}
                    </td>
                    <td className="text-slate md:px-5 md:py-4">
                      {s.modeLabel}
                      {s.location && <span className="block text-xs">{s.location}</span>}
                    </td>
                    <td className="text-slate md:px-5 md:py-4">{s.seatsLabel}</td>
                    <td className="md:px-5 md:py-4">
                      <span className={cn("chip", s.status === "OPEN" ? "bg-emerald-50 text-emerald-700" : s.status === "FULL" ? "bg-rose-50 text-rose-700" : "bg-mist text-slate")}>{s.statusLabel}</span>
                    </td>
                    <td className="pt-2 md:px-5 md:py-4 md:text-end">
                      {s.status === "OPEN" && (
                        <Link href={`/${locale}/register?program=${s.programSlug}&session=${s.id}`} className="btn btn-primary btn-sm">
                          {labels.enroll}
                        </Link>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </motion.div>
        ) : (
          <motion.div key="cal" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} className="card mt-6 p-5">
            <div className="flex items-center justify-between">
              <button type="button" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))} className="rounded-lg p-2 hover:bg-mist" aria-label={labels.prev}>
                <ArrowIcon className="h-5 w-5 rotate-180" />
              </button>
              <div className="text-center">
                <p className="text-lg font-bold text-navy" aria-live="polite">
                  {monthFmt.format(cursor)}
                </p>
                <button type="button" onClick={() => setCursor(new Date(new Date().getFullYear(), new Date().getMonth(), 1))} className="text-xs font-semibold text-brand hover:underline">
                  {labels.today}
                </button>
              </div>
              <button type="button" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))} className="rounded-lg p-2 hover:bg-mist" aria-label={labels.next}>
                <ArrowIcon className="h-5 w-5" />
              </button>
            </div>
            <div className="mt-4 grid grid-cols-7 gap-1 text-center text-xs font-semibold text-slate">
              {labels.weekdays.map((w) => (
                <div key={w} className="py-2">
                  {w}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-1">
              {days.map((d, i) => {
                if (!d) return <div key={i} />;
                const items = byDay.get(dayKey(d)) ?? [];
                return (
                  <div key={i} className={cn("min-h-20 rounded-lg border p-1.5 text-start", items.length ? "border-brand/30 bg-sky-50" : "border-line", dayKey(d) === today && "ring-2 ring-gold")}>
                    <span className="text-xs font-semibold text-navy" dir="ltr">
                      {d.getDate()}
                    </span>
                    <div className="mt-1 space-y-1">
                      {items.slice(0, 3).map((s) => (
                        <Link
                          key={s.id}
                          href={`/${locale}/programs/${s.programSlug}?session=${s.id}#register`}
                          title={`${s.programTitle} – ${s.modeLabel}`}
                          className={cn("block truncate rounded px-1.5 py-0.5 text-[11px] font-semibold text-white transition hover:opacity-90", s.status === "OPEN" ? "bg-brand" : "bg-slate")}
                          dir="ltr"
                        >
                          {s.code || s.programTitle}
                        </Link>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
