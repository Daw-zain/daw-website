/** next/image loader for the static (GitHub Pages) build: no optimisation server, just add the base path. */
export default function imageLoader({ src, width }: { src: string; width: number; quality?: number }) {
  if (!src.startsWith("/") || src.startsWith("//")) return src;
  const base = process.env.NEXT_PUBLIC_BASE_PATH || "";
  return `${base}${src}${src.includes("?") ? "&" : "?"}w=${width}`;
}
