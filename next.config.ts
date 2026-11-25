import type { NextConfig } from "next";

/**
 * Two ways to run the site:
 *  - Full server (local / VPS): admin dashboard, server actions, email. `npm run dev` / `npm run start`.
 *  - Static export for GitHub Pages: STATIC_EXPORT=1 (see .github/workflows/pages.yml and scripts/prepare-static.mjs).
 *    Pages are pre-rendered from the database at build time; forms and learner accounts talk to Supabase from the browser.
 */
const isStatic = process.env.STATIC_EXPORT === "1";
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
];

const serverConfig: NextConfig = {
  poweredByHeader: false,
  eslint: { ignoreDuringBuilds: true },
  images: {
    formats: ["image/avif", "image/webp"],
  },
  experimental: {
    serverActions: { bodySizeLimit: "12mb" },
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

const staticConfig: NextConfig = {
  output: "export",
  basePath: basePath || undefined,
  trailingSlash: true,
  eslint: { ignoreDuringBuilds: true },
  images: { loader: "custom", loaderFile: "./src/lib/image-loader.ts" },
  env: { NEXT_PUBLIC_STATIC: "1", NEXT_PUBLIC_BASE_PATH: basePath },
  // scripts/prepare-static.mjs swaps src/app/actions/public.ts and src/lib/auth.ts for src/lib/static/*.
};

export default isStatic ? staticConfig : serverConfig;
