# Daw Zainelabideen – Project Management Training & Consulting

A bilingual (Arabic default / English) personal website for a project management trainer and consultant. It includes a working admin dashboard, a database, real forms and email notifications, and is structured so an e-learning platform can be added later.

- **Stack:** Next.js 15 (App Router) · React 19 · TypeScript · Tailwind CSS 4 · Framer Motion · Prisma ORM · SQLite (dev) / PostgreSQL (prod) · Nodemailer
- **Docs:** [Admin guide (Arabic)](docs/ADMIN-GUIDE.md) · [Operations, deployment & backups](docs/OPERATIONS.md)

## Quick start (local)

Requires Node.js 20+.

```powershell
npm install
copy .env.example .env      # then edit .env (AUTH_SECRET, ADMIN_EMAIL, ADMIN_PASSWORD …)
npm run db:setup            # creates the database + seeds bilingual content + first admin
npm run build
npm run start               # http://localhost:3000  (admin: http://localhost:3000/admin)
```

For development with hot reload use `npm run dev`.

## What's included

| Area | Details |
|---|---|
| Public pages (AR + EN) | Home, About, Training Programs (+ a page per program), Consulting (+ a page per service), Corporate Training, Knowledge Hub (articles, tips, templates, quizzes, videos), Training Calendar (list + calendar views), Credentials, Contact, Search, Register, printable CV, Privacy, Newsletter confirm/unsubscribe, learner account (saved resources) |
| Forms (stored in DB + admin notification) | Course registration (program + session, seat checks), consultation booking, corporate training request with file attachment, contact, newsletter (double opt-in, unsubscribe), learner sign-up/sign-in |
| Admin dashboard `/admin` | Programs, sessions, consulting services, Knowledge Hub, testimonials (consent-gated), credentials, numbers, FAQs, media library, request inboxes with statuses/notes/CSV export, subscribers, users & roles (Admin/Editor), site settings, activity log, JSON backup, reports, setup checklist. Admin UI in Arabic or English. |
| SEO | Per-page titles/descriptions, canonical + hreflang (ar/en/x-default), Open Graph image, JSON-LD (Person, ProfessionalService, Course, Service, Article, EducationEvent, Breadcrumb), `sitemap.xml`, `robots.txt`, share buttons (LinkedIn, Facebook, WhatsApp) |
| Security | Signed httpOnly session cookies, bcrypt passwords, role checks on every admin action, honeypot + timing + rate-limit anti-spam, zod validation, upload type sniffing, private attachments, sanitized Markdown, security headers, audit log |
| UX | RTL/LTR, sticky header with animated underline, scroll reveal, animated hero, counters, accordion, interactive cards, page transitions, `prefers-reduced-motion` support, mobile menu, floating WhatsApp button |

## Data policy (important)

The site never invents data. The following are **intentionally empty** until real information is entered in the dashboard (the dashboard shows a "setup checklist"):

- Portrait photo (a monogram frame is shown until a real photo is uploaded)
- Phone, WhatsApp, email, LinkedIn, address
- Course dates, seats, program durations/hours (programs start as "Coming soon – register interest")
- Testimonials (only shown when the participant's consent is recorded)
- Training statistics: only facts from the brief are seeded (3 PMI certifications, career since 1990, IT/GIS since 2015, 2 degrees)
- CV PDF (an auto-generated printable CV is used until one is uploaded)

The four Knowledge Hub articles, the quiz and the risk-register template are starter content written for review — edit or unpublish them from **Admin → Knowledge Hub**.

The PMI Authorized Training Partner seal is shown on the home page at the owner's instruction (Admin → Settings → "atpBadge"; clear it to hide). The PMI logo is not used as the site logo, and completion certificates are described as program certificates, not PMI certifications.

Brand images (portrait, logo, badges) live in `public/images/` so they are part of the repository and deployments.

## Project structure

```
prisma/              schema.prisma, seed.ts, seed-content/ (initial bilingual content)
public/downloads/    free templates
scripts/             backup.ts, restore.ts, use-postgres.mjs
src/app/[locale]/    public pages (ar | en)
src/app/admin/       admin dashboard + server actions
src/app/actions/     public form server actions
src/app/api/admin/   CSV export, backup, private file download
src/components/      UI, forms, admin components
src/dictionaries/    ar.ts / en.ts – every UI string in both languages
src/lib/             db, auth, i18n, mail, notifications, storage, SEO, queries
storage/             uploaded files (created at runtime; back it up)
```

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Development server |
| `npm run build` / `npm run start` | Production build / server |
| `npm run db:setup` | Create tables + seed (safe to re-run; never overwrites edits) |
| `npm run db:use-postgres` | Switch Prisma to PostgreSQL for production |
| `npm run backup` | Full backup (DB + uploaded files) into `backups/` |
| `npm run restore -- <folder> --yes` | Restore a backup |
| `npm run typecheck` | TypeScript check |
