"use client";

import type { ReactNode } from "react";
import type { Dictionary } from "@/dictionaries/en";
import type { ExamMe, SessionState } from "@/lib/exams/client";
import { PageHero } from "@/components/ui";

export type ExamLabels = Dictionary["exams"];

/** Live site URL, used when the page is opened on the local full-server version */
const LIVE_URL = "https://daw-zain.github.io/daw-website";

export function Spinner() {
  return (
    <div className="grid min-h-[40vh] place-items-center" role="status" aria-live="polite">
      <span className="h-8 w-8 animate-spin rounded-full border-4 border-brand/20 border-t-brand" aria-hidden="true" />
    </div>
  );
}

export function Notice({ tone = "info", children }: { tone?: "info" | "error" | "success"; children: ReactNode }) {
  const styles = {
    info: "border-brand/20 bg-brand/5 text-navy",
    error: "border-gold/30 bg-gold/5 text-gold-600",
    success: "border-emerald-200 bg-emerald-50 text-emerald-800",
  }[tone];
  return (
    <div className={`rounded-xl border px-4 py-3 text-sm leading-6 ${styles}`} role={tone === "error" ? "alert" : "status"}>
      {children}
    </div>
  );
}

export const RoleBadge = ({ role, labels }: { role: ExamMe["role"]; labels: ExamLabels }) => (
  <span className="inline-flex items-center rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-white ring-1 ring-white/20">
    {labels.yourRole}: {labels.roles[role]}
  </span>
);

/**
 * Common frame of every exam page: handles loading, the local-server notice, errors
 * and a disabled account, and renders `children(me)` once the member is known.
 */
export function ExamShell({
  locale,
  labels,
  state,
  reload,
  title,
  text,
  crumbs,
  children,
}: {
  locale: string;
  labels: ExamLabels;
  state: SessionState;
  reload: () => void;
  title: string;
  text?: string;
  crumbs: { href?: string; label: string }[];
  children: (me: ExamMe) => ReactNode;
}) {
  const ready = state.status === "ready";
  return (
    <>
      <PageHero title={title} text={text} crumbs={crumbs}>
        {ready && (
          <div className="mt-5">
            <RoleBadge role={state.me.role} labels={labels} />
          </div>
        )}
      </PageHero>
      <section className="py-12 sm:py-14">
        <div className="container-x">
          {state.status === "loading" && <Spinner />}
          {state.status === "server" && (
            <Notice>
              <p>{labels.serverNotice}</p>
              <a href={`${LIVE_URL}/${locale}/exams/`} className="btn btn-primary btn-sm mt-3" target="_blank" rel="noopener">
                {labels.openLive} ↗
              </a>
            </Notice>
          )}
          {state.status === "error" && (
            <Notice tone="error">
              <p>{state.code === "account_disabled" ? labels.disabled : state.code === "account_conflict" ? labels.conflict : labels.errorGeneric}</p>
              {state.code !== "account_disabled" && (
                <button type="button" onClick={reload} className="btn btn-outline btn-sm mt-3">
                  {labels.retry}
                </button>
              )}
            </Notice>
          )}
          {ready && children(state.me)}
        </div>
      </section>
    </>
  );
}
