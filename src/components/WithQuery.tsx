"use client";

import { Fragment, Suspense, useEffect, useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";

function Reader({ children, fallback }: { children: (q: URLSearchParams) => ReactNode; fallback: ReactNode }) {
  const q = useSearchParams();
  // Render exactly what the pre-rendered HTML has first, then switch to the URL-aware version after hydration
  // (a pre-rendered page has no query string, and React does not patch form values on hydration).
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  // different keys → the URL-aware version mounts fresh (its initial state comes from the query)
  return mounted ? <Fragment key={`q:${q.toString()}`}>{children(q)}</Fragment> : <Fragment key="pre">{fallback}</Fragment>;
}

/**
 * Read the URL query in the browser (works on the static GitHub Pages site, where pages are pre-rendered
 * without a request). `fallback` is what the pre-rendered HTML shows before the query is known.
 */
export function WithQuery({ children, fallback }: { children: (q: URLSearchParams) => ReactNode; fallback: ReactNode }) {
  return (
    <Suspense fallback={fallback}>
      <Reader fallback={fallback}>{children}</Reader>
    </Suspense>
  );
}
