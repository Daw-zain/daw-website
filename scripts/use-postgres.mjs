// Switch the Prisma datasource provider from SQLite (development) to PostgreSQL (production).
//   npm run db:use-postgres          → provider = "postgresql"
//   npm run db:use-postgres -- sqlite → back to SQLite
import { readFileSync, writeFileSync } from "node:fs";

const target = process.argv[2] === "sqlite" ? "sqlite" : "postgresql";
const file = new URL("../prisma/schema.prisma", import.meta.url);
const src = readFileSync(file, "utf8");
const out = src.replace(/(datasource db \{\s*provider\s*=\s*)"(sqlite|postgresql)"/, `$1"${target}"`);
writeFileSync(file, out);
console.log(`✔ Prisma provider set to ${target}. Now set DATABASE_URL and run: npx prisma db push && npm run db:seed`);
