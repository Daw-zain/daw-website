import type { Locale } from "./constants";

export function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

/** Pick the Ar/En variant of a field: pick(program, "title", "en") → program.titleEn */
export function pick<T extends object>(obj: T, field: string, locale: Locale): string {
  const key = `${field}${locale === "ar" ? "Ar" : "En"}` as keyof T;
  const fallback = `${field}${locale === "ar" ? "En" : "Ar"}` as keyof T;
  const v = (obj[key] as unknown as string) || (obj[fallback] as unknown as string) || "";
  return v;
}

/** Split a newline-separated admin text field into list items */
export function lines(v: string | null | undefined): string[] {
  return (v ?? "")
    .split(/\r?\n/)
    .map((l) => l.replace(/^[-•*]\s*/, "").trim())
    .filter(Boolean);
}

export function formatDate(d: Date | string, locale: Locale, opts?: Intl.DateTimeFormatOptions) {
  const date = typeof d === "string" ? new Date(d) : d;
  return new Intl.DateTimeFormat(locale === "ar" ? "ar-LY-u-nu-latn" : "en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    ...opts,
  }).format(date);
}

export function siteUrl(path = "") {
  const base = (process.env.SITE_URL || "http://localhost:3000").replace(/\/$/, "");
  return `${base}${path}`;
}

export function slugify(input: string) {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9؀-ۿ]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

/** Normalise Arabic + Latin text for search */
export function normalizeText(s: string) {
  return s
    .toLowerCase()
    .replace(/[ً-ٰٟ]/g, "") // diacritics
    .replace(/[إأآا]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/ـ/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function whatsappLink(number: string | undefined | null, text?: string) {
  if (!number) return null;
  const digits = number.replace(/[^\d]/g, "");
  if (!digits) return null;
  return `https://wa.me/${digits}${text ? `?text=${encodeURIComponent(text)}` : ""}`;
}

export function youtubeEmbed(url: string | null | undefined) {
  if (!url) return null;
  const yt = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{6,})/);
  if (yt) return `https://www.youtube-nocookie.com/embed/${yt[1]}`;
  const vimeo = url.match(/vimeo\.com\/(\d+)/);
  if (vimeo) return `https://player.vimeo.com/video/${vimeo[1]}`;
  return null;
}
