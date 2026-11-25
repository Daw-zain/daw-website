"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn, normalizeText } from "@/lib/utils";
import { WithQuery } from "./WithQuery";
import { EmptyState } from "./ui";

export type SearchDoc = { group: string; href: string; title: string; text: string; tag: string; haystack: string };

type Labels = { all: string; hint: string; resultsFor: string; noResults: string; groups: Record<string, string> };

/** Site search over an index built at render time; reads ?q= and ?in= in the browser. */
export function SearchResults({ docs, labels }: { docs: SearchDoc[]; labels: Labels }) {
  return <WithQuery fallback={<p className="text-slate">{labels.hint}</p>}>{(q) => <Results docs={docs} labels={labels} q={q} />}</WithQuery>;
}

function Results({ docs, labels, q }: { docs: SearchDoc[]; labels: Labels; q: URLSearchParams }) {
  const pathname = usePathname();
  const raw = (q.get("q") ?? "").trim().slice(0, 100);
  if (raw.length < 2) return <p className="text-slate">{labels.hint}</p>;
  const terms = normalizeText(raw).split(" ").filter(Boolean);
  const keys = Object.keys(labels.groups);
  const scope = keys.includes(q.get("in") ?? "") ? q.get("in")! : undefined;
  const groups = keys.map((k) => ({ key: k, title: labels.groups[k], hits: docs.filter((d) => d.group === k && terms.every((w) => d.haystack.includes(w))) }));
  const total = groups.reduce((n, g) => n + g.hits.length, 0);
  const shown = scope ? groups.filter((g) => g.key === scope) : groups;
  const filterHref = (k?: string) => `${pathname}?q=${encodeURIComponent(raw)}${k ? `&in=${k}` : ""}`;

  return (
    <>
      <p className="text-slate">
        {labels.resultsFor} “<strong className="text-navy">{raw}</strong>” · <span dir="ltr">{total}</span>
      </p>
      <div className="mt-5 flex flex-wrap gap-2">
        {[{ k: undefined as string | undefined, label: labels.all, n: total }, ...groups.map((g) => ({ k: g.key, label: g.title, n: g.hits.length }))].map((f) => (
          <Link key={f.label} href={filterHref(f.k)} scroll={false} className={cn("rounded-full border px-3.5 py-1.5 text-sm font-semibold transition", scope === f.k ? "border-navy bg-navy text-white" : "border-line bg-white text-navy hover:border-brand")}>
            {f.label} <span className="opacity-60">({f.n})</span>
          </Link>
        ))}
      </div>
      {total === 0 ? (
        <div className="mt-8">
          <EmptyState text={labels.noResults} />
        </div>
      ) : (
        shown
          .filter((g) => g.hits.length)
          .map((g) => (
            <div key={g.key} className="mt-10">
              <h2 className="text-xl font-bold">{g.title}</h2>
              <ul className="mt-4 space-y-3">
                {g.hits.map((h) => (
                  <li key={h.href}>
                    <Link href={h.href} className="card card-hover block p-5">
                      <span className="text-xs font-semibold uppercase tracking-wider text-gold-600">{h.tag}</span>
                      <span className="mt-1 block text-lg font-bold text-navy">{h.title}</span>
                      <span className="mt-1 line-clamp-2 block text-[15px] text-slate">{h.text}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))
      )}
    </>
  );
}

