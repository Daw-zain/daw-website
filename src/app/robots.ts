import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/utils";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/admin", "/api", "/ar/account", "/en/account", "/ar/search", "/en/search", "/ar/newsletter", "/en/newsletter", "/ar/exams", "/en/exams"] }],
    sitemap: siteUrl("/sitemap.xml"),
    host: siteUrl(),
  };
}
