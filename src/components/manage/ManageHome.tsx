"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { can, rpc, type ExamMe } from "@/lib/exams/client";
import type { AuditData } from "@/lib/exams/manage";
import type { ExamLabels } from "@/components/exams/ExamShell";
import { allowed, ManageShell, SectionTitle, type ManageSection } from "./ManageShell";
import { auditName, auditWhen } from "./ManageAudit";
import { MasteryPolicy } from "@/components/exams/MasteryPolicy";

/** /[locale]/manage — the sections the member may open, and the latest activity */
export function ManageHome({ locale, labels }: { locale: string; labels: ExamLabels }) {
  return (
    <ManageShell locale={locale} labels={labels} section="home">
      {(me) => <Home me={me} locale={locale} labels={labels} />}
    </ManageShell>
  );
}

/** /[locale]/manage/settings — platform rules */
export function ManageSettings({ locale, labels }: { locale: string; labels: ExamLabels }) {
  const s = labels.manage.settings;
  return (
    <ManageShell locale={locale} labels={labels} section="settings">
      {() => (
        <div>
          <SectionTitle title={s.title} text={s.intro} />
          <MasteryPolicy labels={labels} />
        </div>
      )}
    </ManageShell>
  );
}

function Home({ me, locale, labels }: { me: ExamMe; locale: string; labels: ExamLabels }) {
  const m = labels.manage;
  const [recent, setRecent] = useState<AuditData | null>(null);
  const seesLog = can(me, "audit", "read");
  useEffect(() => {
    if (seesLog) rpc<AuditData>("exam_audit", { p_filter: {} }).then(setRecent).catch(() => setRecent(null));
  }, [seesLog]);

  const cards: { key: keyof typeof m.cards; href: string }[] = [
    ...(["trainees", "trainers", "users", "roles", "audit", "settings"] as const).filter((s: ManageSection) => allowed(me, s)).map((s) => ({ key: s as keyof typeof m.cards, href: `/${locale}/manage/${s}` })),
    ...(me.courses.length ? [{ key: "exams" as const, href: `/${locale}/exams` }] : []),
  ];

  return (
    <div className="space-y-8">
      <SectionTitle title={m.nav.home} text={m.homeIntro} />
      <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {cards.map((c) => (
          <li key={c.key}>
            <Link href={c.href} className="card card-hover group block h-full p-5">
              <h3 className="font-bold text-navy group-hover:text-brand">{m.nav[c.key]}</h3>
              <p className="mt-1 text-sm leading-6 text-slate">{m.cards[c.key]}</p>
            </Link>
          </li>
        ))}
      </ul>
      {recent && recent.items.length > 0 && (
        <section>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-lg font-bold text-navy">{m.recent}</h3>
            <Link href={`/${locale}/manage/audit`} className="text-sm font-semibold text-brand hover:underline">{m.allActivity}</Link>
          </div>
          <ul className="card mt-3 divide-y divide-line">
            {recent.items.slice(0, 8).map((x, i) => (
              <li key={i} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
                <span className="min-w-0">
                  <span className="font-semibold text-navy">{auditName(x.action, labels)}</span>
                  <span className="text-slate"> · {x.actorName || x.actorEmail || m.audit.system}{x.course ? ` · ${x.course}` : ""}</span>
                </span>
                <span className="text-xs text-slate">{auditWhen(x.at, locale)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
