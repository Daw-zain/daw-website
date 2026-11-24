import ar from "@/dictionaries/ar";
import en from "@/dictionaries/en";
import type { Dictionary } from "@/dictionaries/en";
import { isLocale, type Locale, DEFAULT_LOCALE } from "./constants";

const dictionaries: Record<Locale, Dictionary> = { ar, en };

export function getDictionary(locale: string): Dictionary {
  return dictionaries[isLocale(locale) ? locale : DEFAULT_LOCALE];
}

export function dir(locale: Locale) {
  return locale === "ar" ? "rtl" : "ltr";
}

export function otherLocale(locale: Locale): Locale {
  return locale === "ar" ? "en" : "ar";
}

/** Build a localized href: href("en", "/programs") → "/en/programs" */
export function href(locale: Locale, path = "") {
  const p = path.startsWith("/") ? path : `/${path}`;
  return `/${locale}${p === "/" ? "" : p}`;
}

export type { Dictionary, Locale };
