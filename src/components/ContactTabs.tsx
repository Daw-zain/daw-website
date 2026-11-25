"use client";

import { useState, type ReactNode } from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { WithQuery } from "./WithQuery";

type Tab = { label: string; content: ReactNode };

/** `keys` maps ?tab=<key> in the URL to a tab (e.g. /contact?tab=consultation). */
export function ContactTabs({ tabs, initial = 0, keys }: { tabs: Tab[]; initial?: number; keys?: string[] }) {
  if (!keys) return <TabsInner tabs={tabs} initial={initial} />;
  return (
    <WithQuery fallback={<TabsInner tabs={tabs} initial={initial} />}>
      {(q) => {
        const i = keys.indexOf(q.get("tab") ?? "");
        return <TabsInner key={i} tabs={tabs} initial={i >= 0 ? i : initial} />;
      }}
    </WithQuery>
  );
}

function TabsInner({ tabs, initial }: { tabs: Tab[]; initial: number }) {
  const [active, setActive] = useState(initial);
  return (
    <div>
      <div role="tablist" className="flex flex-wrap gap-1 rounded-xl border border-line bg-mist p-1">
        {tabs.map((t, i) => (
          <button
            key={t.label}
            role="tab"
            type="button"
            id={`ct-${i}`}
            aria-selected={active === i}
            aria-controls={`cp-${i}`}
            onClick={() => setActive(i)}
            className={cn("relative flex-1 rounded-lg px-4 py-2.5 text-sm font-semibold transition", active === i ? "text-navy" : "text-slate hover:text-navy")}
          >
            {active === i && <motion.span layoutId="ct-pill" className="absolute inset-0 rounded-lg bg-white shadow-sm" transition={{ type: "spring", stiffness: 400, damping: 32 }} />}
            <span className="relative">{t.label}</span>
          </button>
        ))}
      </div>
      {tabs.map((t, i) => (
        <div key={i} role="tabpanel" id={`cp-${i}`} aria-labelledby={`ct-${i}`} hidden={active !== i} className="mt-8">
          {t.content}
        </div>
      ))}
    </div>
  );
}
