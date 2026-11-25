// After `next build` (static export): add the files GitHub Pages needs in out/.
import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";

const out = path.join(process.cwd(), "out");
if (!existsSync(out)) {
  console.error("✗ out/ not found — run the static build first");
  process.exit(1);
}
const base = process.env.NEXT_PUBLIC_BASE_PATH || "";

// No Jekyll processing (keeps the _next folder).
writeFileSync(path.join(out, ".nojekyll"), "");

// Root URL → Arabic (or the visitor's last language).
writeFileSync(
  path.join(out, "index.html"),
  `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Daw Zainelabideen</title><link rel="canonical" href="${base}/ar/">
<script>var l=localStorage.getItem("dz_locale");location.replace("${base}/"+(l==="en"?"en":"ar")+"/"+location.search+location.hash);</script>
<meta http-equiv="refresh" content="0;url=${base}/ar/"></head><body><a href="${base}/ar/">ضو زين العابدين</a></body></html>`,
);
console.log("✔ out/ ready for GitHub Pages");
