// Prepares a THROWAWAY checkout for the GitHub Pages (static export) build. Used by .github/workflows/pages.yml.
// It deletes the server-only parts (admin dashboard, API routes, middleware), so it refuses to run outside CI
// unless you pass --force (never run it in your working folder).
import { cpSync, existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

if (!process.env.CI && !process.argv.includes("--force")) {
  console.error("✗ prepare-static deletes the admin/API code. It only runs in CI (or with --force in a throwaway copy).");
  process.exit(1);
}

const root = process.cwd();
const rm = (p) => rmSync(path.join(root, p), { recursive: true, force: true });

// 1. Server-only code: not part of the public static site.
for (const p of ["src/app/admin", "src/components/admin", "src/app/api", "src/app/uploads", "src/middleware.ts", "src/app/[locale]/[...rest]"]) rm(p);
for (const f of ["audit", "notify", "spam", "inbox", "inbox-config", "backup", "csv", "admin-resources", "admin-i18n", "jwt", "storage", "mail"]) rm(`src/lib/${f}.ts`);
for (const f of readdirSync(path.join(root, "scripts"))) if (f.endsWith(".ts")) rm(`scripts/${f}`); // local admin tools

// 1b. Swap the server actions / server session for their browser (Supabase) versions.
writeFileSync(path.join(root, "src/app/actions/public.ts"), '// Static build: forms talk to Supabase from the browser.\nexport * from "@/lib/static/actions";\n');
writeFileSync(path.join(root, "src/lib/auth.ts"), '// Static build: no server session.\nexport * from "@/lib/static/auth";\n');

// 2. Render everything at build time.
function walk(dir) {
  for (const name of readdirSync(dir)) {
    const f = path.join(dir, name);
    if (statSync(f).isDirectory()) walk(f);
    else if (/\.(tsx?|jsx?)$/.test(name)) {
      const src = readFileSync(f, "utf8");
      let out = src.replace(/export const dynamic = "force-dynamic";/g, 'export const dynamic = "force-static";');
      // metadata routes (OG image, robots, sitemap) must be marked static for `output: export`
      if (/^(opengraph-image|twitter-image|robots|sitemap|manifest)\./.test(name) && !/export const dynamic/.test(out)) out += '\nexport const dynamic = "force-static";\n';
      if (out !== src) writeFileSync(f, out);
    }
  }
}
walk(path.join(root, "src/app"));

// 2b. Tell Next which pages to pre-render (kept out of the source so the live server always renders on request).
const params = {
  "src/app/[locale]/layout.tsx": `export async function generateStaticParams() {\n  return [{ locale: "ar" }, { locale: "en" }];\n}\n`,
  "src/app/[locale]/programs/[slug]/page.tsx": `export async function generateStaticParams() {\n  const { getPrograms } = await import("@/lib/queries");\n  return (await getPrograms()).map((p) => ({ slug: p.slug }));\n}\n`,
  "src/app/[locale]/consulting/[slug]/page.tsx": `export async function generateStaticParams() {\n  const { getServices } = await import("@/lib/queries");\n  return (await getServices()).map((s) => ({ slug: s.slug }));\n}\n`,
  "src/app/[locale]/knowledge/[slug]/page.tsx": `export async function generateStaticParams() {\n  const { getResources } = await import("@/lib/queries");\n  return (await getResources()).map((r) => ({ slug: r.slug }));\n}\n`,
};
for (const [file, code] of Object.entries(params)) {
  const f = path.join(root, file);
  writeFileSync(f, readFileSync(f, "utf8") + "\n" + code);
}

// 3. Files uploaded in the admin and published with `npm run uploads:publish` (served at /uploads/...).
if (existsSync(path.join(root, "published-uploads"))) cpSync(path.join(root, "published-uploads"), path.join(root, "public/uploads"), { recursive: true });

// 4. PostgreSQL (Supabase) schema.
const schema = path.join(root, "prisma/schema.prisma");
writeFileSync(schema, readFileSync(schema, "utf8").replace(/(datasource db \{\s*provider\s*=\s*)"(sqlite|postgresql)"/, '$1"postgresql"'));

console.log("✔ Prepared for static export");
