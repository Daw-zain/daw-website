/**
 * Seeds the database with the initial bilingual content and the first admin account.
 * Safe to re-run: existing records (matched by slug / key / email) are NOT overwritten,
 * so edits made in the admin dashboard are preserved.
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { programs, deliveryAr, deliveryEn } from "./seed-content/programs";
import { services, credentials, stats, faqs, settings } from "./seed-content/other";
import { resources } from "./seed-content/resources";

const db = new PrismaClient();
const j = (a: string[]) => a.join("\n");

async function main() {
  // ── Admin account ──
  const email = (process.env.ADMIN_EMAIL || "").toLowerCase().trim();
  const password = process.env.ADMIN_PASSWORD || "";
  if (email && password) {
    if (password.length < 10) throw new Error("ADMIN_PASSWORD must be at least 10 characters");
    const exists = await db.user.findUnique({ where: { email } });
    if (!exists) {
      await db.user.create({ data: { email, name: "Administrator", role: "ADMIN", passwordHash: await bcrypt.hash(password, 12) } });
      console.log(`✔ Admin account created: ${email}`);
    } else console.log(`• Admin account already exists: ${email}`);
  } else {
    console.warn("! ADMIN_EMAIL / ADMIN_PASSWORD not set – no admin account created");
  }

  // ── Site settings (create-only) ──
  for (const [key, value] of Object.entries(settings)) {
    await db.setting.upsert({ where: { key }, update: {}, create: { key, value } });
  }

  // ── Programs ──
  let order = 1;
  for (const p of programs) {
    const { objectivesAr, objectivesEn, audienceAr, audienceEn, prerequisitesAr, prerequisitesEn, outlineAr, outlineEn, outcomesAr, outcomesEn, ...rest } = p;
    await db.program.upsert({
      where: { slug: p.slug },
      update: {},
      create: {
        ...rest,
        featured: p.featured ?? false,
        objectivesAr: j(objectivesAr),
        objectivesEn: j(objectivesEn),
        audienceAr: j(audienceAr),
        audienceEn: j(audienceEn),
        prerequisitesAr: j(prerequisitesAr),
        prerequisitesEn: j(prerequisitesEn),
        outlineAr: j(outlineAr),
        outlineEn: j(outlineEn),
        outcomesAr: j(outcomesAr),
        outcomesEn: j(outcomesEn),
        deliveryAr,
        deliveryEn,
        status: "COMING_SOON",
        order: order++,
      },
    });
  }
  console.log(`✔ ${programs.length} programs`);

  order = 1;
  for (const s of services) {
    await db.consultingService.upsert({ where: { slug: s.slug }, update: {}, create: { ...s, order: order++ } });
  }
  console.log(`✔ ${services.length} consulting services`);

  if ((await db.credential.count()) === 0) {
    for (const c of credentials) await db.credential.create({ data: c });
    console.log(`✔ ${credentials.length} credentials`);
  }
  if ((await db.stat.count()) === 0) {
    for (const s of stats) await db.stat.create({ data: s });
    console.log(`✔ ${stats.length} stats`);
  }
  if ((await db.faq.count()) === 0) {
    let i = 1;
    for (const f of faqs) await db.faq.create({ data: { ...f, order: i++ } });
    console.log(`✔ ${faqs.length} FAQs`);
  }

  for (const r of resources) {
    await db.resource.upsert({ where: { slug: r.slug }, update: {}, create: r });
  }
  console.log(`✔ ${resources.length} knowledge hub resources`);

  console.log("Done. Testimonials, course dates and contact details are intentionally empty – add real data from the admin dashboard.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
