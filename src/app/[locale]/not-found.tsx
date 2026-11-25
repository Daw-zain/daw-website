"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { getDictionary } from "@/lib/i18n";
import { BASE_PATH } from "@/lib/env-public";

export default function NotFound() {
  const path = (usePathname() || "").replace(BASE_PATH, "");
  const locale = /^\/en(\/|$)/.test(path) ? "en" : "ar";
  const t = getDictionary(locale);
  return (
    <section className="grid min-h-[60vh] place-items-center px-5 py-20 text-center">
      <div>
        <p className="text-8xl font-extrabold text-sky" dir="ltr">
          404
        </p>
        <h1 className="mt-4 text-3xl font-bold">{t.notFound.title}</h1>
        <p className="mt-3 text-slate">{t.notFound.text}</p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link href={`/${locale}`} className="btn btn-primary">
            {t.notFound.home}
          </Link>
          <Link href={`/${locale}/programs`} className="btn btn-outline">
            {t.cta.explore}
          </Link>
        </div>
      </div>
    </section>
  );
}
