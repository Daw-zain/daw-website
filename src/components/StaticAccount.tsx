"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/lib/static/supabase";
import { readFavorites } from "@/lib/static/actions";
import { withBase } from "@/lib/env-public";
import { EmptyState, PageHero } from "./ui";

type Labels = {
  welcome: string;
  dashboardText: string;
  logout: string;
  savedList: string;
  noFavorites: string;
  knowledge: string;
};

/** Learner dashboard on the static site: the session lives in the browser (Supabase Auth). */
export function StaticAccount({ locale, labels, resources }: { locale: string; labels: Labels; resources: { id: string; node: ReactNode }[] }) {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [favs, setFavs] = useState<string[]>([]);

  useEffect(() => {
    const sb = supabase();
    sb.auth.getSession().then(({ data }) => {
      const u = data.session?.user ?? null;
      if (!u) {
        window.location.replace(withBase(`/${locale}/account/login/?next=${encodeURIComponent(`/${locale}/account/`)}`));
        return;
      }
      setUser(u);
      setFavs(readFavorites(u.id));
    });
  }, [locale]);

  if (!user)
    return (
      <div className="grid min-h-[50vh] place-items-center">
        <span className="h-8 w-8 animate-spin rounded-full border-4 border-brand/20 border-t-brand" aria-hidden="true" />
      </div>
    );

  const name = String(user.user_metadata?.name || user.email || "");
  const saved = favs.map((id) => resources.find((r) => r.id === id)).filter(Boolean) as { id: string; node: ReactNode }[];
  const logout = async () => {
    await supabase().auth.signOut();
    window.location.assign(withBase(`/${locale}/`));
  };

  return (
    <>
      <PageHero title={`${labels.welcome}${locale === "ar" ? "، " : ", "}${name}`} text={labels.dashboardText}>
        <div className="mt-6 flex flex-wrap gap-3">
          <button type="button" onClick={logout} className="btn btn-ghost-light btn-sm">
            {labels.logout}
          </button>
        </div>
      </PageHero>
      <section className="py-14">
        <div className="container-x">
          <h2 className="text-2xl font-bold">{labels.savedList}</h2>
          {saved.length === 0 ? (
            <div className="mt-6">
              <EmptyState text={labels.noFavorites}>
                <Link href={`/${locale}/knowledge`} className="btn btn-primary">
                  {labels.knowledge}
                </Link>
              </EmptyState>
            </div>
          ) : (
            <div className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {saved.map((r) => (
                <div key={r.id}>{r.node}</div>
              ))}
            </div>
          )}
        </div>
      </section>
    </>
  );
}
