"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toggleFavorite } from "@/app/actions/public";
import { BookmarkIcon } from "./Icons";
import { cn } from "@/lib/utils";
import { IS_STATIC } from "@/lib/env-public";
import { supabase } from "@/lib/static/supabase";
import { readFavorites } from "@/lib/static/actions";

export function FavoriteButton({ id, locale, initial, labels }: { id: string; locale: string; initial: boolean; labels: { save: string; saved: string; login: string } }) {
  const [saved, setSaved] = useState(initial);
  const [pending, start] = useTransition();
  const router = useRouter();
  // Static site: saved state lives in this browser for the signed-in learner.
  useEffect(() => {
    if (!IS_STATIC) return;
    supabase()
      .auth.getSession()
      .then(({ data }) => {
        const u = data.session?.user;
        if (u) setSaved(readFavorites(u.id).includes(id));
      })
      .catch(() => {});
  }, [id]);
  return (
    <button
      type="button"
      disabled={pending}
      aria-pressed={saved}
      onClick={() =>
        start(async () => {
          const r = await toggleFavorite(id, locale);
          if ("login" in r) router.push(`/${locale}/account/login?next=${encodeURIComponent(window.location.pathname)}`);
          else setSaved(r.saved);
        })
      }
      className={cn("btn btn-sm border transition", saved ? "border-gold bg-gold/15 text-gold-600" : "border-line bg-white text-navy hover:border-brand hover:text-brand")}
    >
      <BookmarkIcon filled={saved} className={cn("h-4 w-4 transition-transform", pending && "scale-75")} />
      {saved ? labels.saved : labels.save}
    </button>
  );
}
