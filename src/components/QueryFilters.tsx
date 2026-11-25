"use client";

import { Suspense, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { cn, normalizeText } from "@/lib/utils";
import { WithQuery } from "./WithQuery";
import { SearchIcon } from "./Icons";

/**
 * URL-driven filtering (?category=…, ?type=…, ?q=…) that works on the full server and on the static GitHub Pages build.
 * The cards are rendered normally on the server, each wrapped in an element with data-filter-item and data-f-<param>
 * (and data-f-text for text search). <DomFilter> shows/hides them in the browser; <FilterChips> renders the chip links.
 */

export type FilterGroup = { param: string; title?: string; allLabel: string; options: { key: string; label: string }[] };

const chipCls = (active: boolean, small = false) =>
  cn(
    "rounded-full border font-semibold transition",
    small ? "px-3.5 py-1.5 text-sm" : "px-4 py-2 text-sm",
    active ? "border-navy bg-navy text-white" : "border-line bg-white text-navy hover:border-brand hover:text-brand",
  );

function hrefWith(pathname: string, q: URLSearchParams, param: string, value: string) {
  const next = new URLSearchParams(q.toString());
  if (value) next.set(param, value);
  else next.delete(param);
  const s = next.toString();
  return `${pathname}${s ? `?${s}` : ""}`;
}

const activeValue = (g: FilterGroup, q: URLSearchParams) => (g.options.some((o) => o.key === q.get(g.param)) ? q.get(g.param)! : "");

function ChipRow({ group, q, small }: { group: FilterGroup; q: URLSearchParams; small?: boolean }) {
  const pathname = usePathname();
  const active = activeValue(group, q);
  return (
    <>
      {[{ key: "", label: group.allLabel }, ...group.options].map((o) => (
        <Link key={o.key} href={hrefWith(pathname, q, group.param, o.key)} scroll={false} aria-current={active === o.key ? "page" : undefined} className={chipCls(active === o.key, small)}>
          {o.label}
        </Link>
      ))}
    </>
  );
}

/** One chip row (programs page) or titled chip groups (knowledge sidebar) */
export function FilterChips({ groups, navLabel, stacked = false }: { groups: FilterGroup[]; navLabel?: string; stacked?: boolean }) {
  const view = (q: URLSearchParams) =>
    stacked ? (
      <div className="space-y-8">
        {groups.map((g) => (
          <div key={g.param}>
            <h2 className="text-sm font-bold uppercase tracking-wider text-slate">{g.title}</h2>
            <div className="mt-3 flex flex-wrap gap-2">
              <ChipRow group={g} q={q} small />
            </div>
          </div>
        ))}
      </div>
    ) : (
      <nav aria-label={navLabel} className="flex flex-wrap gap-2">
        <ChipRow group={groups[0]} q={q} />
      </nav>
    );
  return <WithQuery fallback={view(new URLSearchParams())}>{view}</WithQuery>;
}

function Apply({ scope, params, emptyId, noResultsId }: { scope: string; params: string[]; emptyId?: string; noResultsId?: string }) {
  const q = useSearchParams();
  useEffect(() => {
    const root = document.getElementById(scope);
    if (!root) return;
    const terms = normalizeText(q.get("q") ?? "").split(" ").filter(Boolean);
    const items = Array.from(root.querySelectorAll<HTMLElement>("[data-filter-item]"));
    let shown = 0;
    for (const el of items) {
      const ok =
        params.every((p) => {
          const v = q.get(p);
          return !v || el.dataset[`f${p[0].toUpperCase()}${p.slice(1)}`] === v;
        }) && (!terms.length || terms.every((w) => normalizeText(el.dataset.fText ?? "").includes(w)));
      el.hidden = !ok;
      if (ok) shown++;
    }
    if (noResultsId) {
      const n = document.getElementById(noResultsId);
      if (n) n.hidden = !(items.length > 0 && shown === 0);
    }
    if (emptyId) {
      const e = document.getElementById(emptyId);
      if (e) e.hidden = items.length > 0;
    }
  }, [q, scope, params, emptyId, noResultsId]);
  return null;
}

/** Shows/hides [data-filter-item] elements inside #scope according to the URL query */
export function DomFilter(props: { scope: string; params: string[]; emptyId?: string; noResultsId?: string }) {
  return (
    <Suspense fallback={null}>
      <Apply {...props} />
    </Suspense>
  );
}

/** Search box that writes ?q= on the current page (keeps the other filters) */
export function QuerySearchBox({ id, placeholder, button, autoFocus, minLength }: { id: string; placeholder: string; button: string; autoFocus?: boolean; minLength?: number }) {
  const inner = (q: URLSearchParams) => <SearchBoxInner q={q} id={id} placeholder={placeholder} button={button} autoFocus={autoFocus} minLength={minLength} />;
  return <WithQuery fallback={inner(new URLSearchParams())}>{inner}</WithQuery>;
}

function SearchBoxInner({ q, id, placeholder, button, autoFocus, minLength }: { q: URLSearchParams; id: string; placeholder: string; button: string; autoFocus?: boolean; minLength?: number }) {
  const router = useRouter();
  const pathname = usePathname();
  const [value, setValue] = useState(q.get("q") ?? "");
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const next = new URLSearchParams(q.toString());
    next.delete("in");
    if (value.trim()) next.set("q", value.trim());
    else next.delete("q");
    const s = next.toString();
    router.push(`${pathname}${s ? `?${s}` : ""}`, { scroll: false });
  };
  return (
    <form onSubmit={submit} className="mt-8 flex max-w-2xl gap-2" role="search">
      <label htmlFor={id} className="sr-only">
        {placeholder}
      </label>
      <div className="relative flex-1">
        <SearchIcon className="pointer-events-none absolute start-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate" />
        <input id={id} name="q" type="search" value={value} onChange={(e) => setValue(e.target.value)} autoFocus={autoFocus} minLength={minLength} placeholder={placeholder} className="field ps-12" />
      </div>
      <button className="btn btn-gold" type="submit">
        {button}
      </button>
    </form>
  );
}
