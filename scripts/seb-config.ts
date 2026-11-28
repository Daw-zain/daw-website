/**
 * Writes public/seb/daleel.seb for the published site and records its Config Key in the database.
 *   npm run seb:config                      → the file, the site address and the key (the general switch is not touched)
 *   npm run seb:config -- https://host/x/   → for another address
 * Publish the site afterwards. Changing any setting changes the key: run this again, never edit the file by hand.
 */
import { PrismaClient } from "@prisma/client";
import { mkdir, writeFile } from "node:fs/promises";
import { configKey, platformSettings, sebFile } from "./lib/seb-config";

async function main() {
  const site = process.argv[2] || "https://daw-zain.github.io/daw-website/";
  const settings = platformSettings(site);
  const key = configKey(settings);
  await mkdir("public/seb", { recursive: true });
  await writeFile("public/seb/daleel.seb", sebFile(settings), "utf8");
  const db = new PrismaClient();
  try {
    const row = await db.sebSetting.findUnique({ where: { id: "main" } });
    // keys typed in by the administrator stay; the key of an earlier file for the same site is replaced
    const kept = row && row.siteUrl === site ? row.configKeys.filter((k) => k !== key).slice(0, 9) : [];
    await db.sebSetting.upsert({ where: { id: "main" }, create: { id: "main", siteUrl: site, configKeys: [key] }, update: { siteUrl: site, configKeys: [key, ...kept] } });
    console.log(`✔ public/seb/daleel.seb written for ${site}`);
    console.log(`✔ Config Key recorded: ${key}`);
    console.log(`  General switch: ${row?.enabled ? "ON" : "off"}`);
  } finally {
    await db.$disconnect();
  }
}

main().catch((e) => {
  console.error("✗", e instanceof Error ? e.message : e);
  process.exit(1);
});
