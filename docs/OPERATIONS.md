# Operations: deployment, email, backups & security

## 1. Environment variables

Copy `.env.example` to `.env` and set:

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | ✔ | SQLite locally (`file:./dev.db`), PostgreSQL in production |
| `SITE_URL` | ✔ | Public URL without trailing slash, e.g. `https://dawzainelabideen.com` — used for canonical URLs, sitemap and email links |
| `AUTH_SECRET` | ✔ | Random string ≥ 32 chars. Changing it signs everyone out |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | first run | First admin account, created by the seed if missing (password ≥ 10 chars) |
| `SMTP_*`, `MAIL_FROM` | recommended | Without SMTP, notifications are still stored in the dashboard and printed in the server log |
| `ADMIN_NOTIFY_EMAIL` | optional | Fallback recipient for request notifications (can be set in Admin → Settings) |
| `NEXT_PUBLIC_GA_ID` | optional | Google Analytics 4 ID (IP anonymization on). Leave empty for no analytics |

## 2. Production deployment

The site stores uploaded files on disk (`storage/`), so the recommended hosting is a **VPS or a container platform with a persistent volume** (e.g. a Linux VPS with Nginx, Railway/Render/Fly.io with a volume). Serverless hosting (e.g. Vercel) would require moving uploads to object storage (S3/R2/Blob) — replace the helpers in `src/lib/storage.ts`.

### Railway (deploys automatically from GitHub)

`railway.json` is already in the repo. Every push to `main` redeploys the site.

1. Sign in at https://railway.com with the GitHub account and create a project → **Deploy from GitHub repo** → `daw-website`.
2. In the project add **Database → PostgreSQL**.
3. On the web service add a **Volume** mounted at `/data`.
4. Web service → **Variables**:
   - `DATABASE_URL` = `${{Postgres.DATABASE_URL}}`
   - `STORAGE_DIR` = `/data`
   - `AUTH_SECRET` = a long random string (32+ chars)
   - `ADMIN_EMAIL`, `ADMIN_PASSWORD` (first admin; change the password after first sign-in)
   - `SITE_URL` = the public URL (e.g. `https://daw.aldaleel.ly`)
   - SMTP variables from section 3
5. **Settings → Networking → Generate Domain** (or add the custom domain and create the CNAME record at the domain's DNS).

The build switches Prisma to PostgreSQL; on start the app runs `prisma db push`, seeds missing content (never overwrites admin edits) and starts Next.js on `$PORT`.

### Steps (Linux VPS example)

```bash
# 1. PostgreSQL database
sudo -u postgres createuser daw --pwprompt
sudo -u postgres createdb daw_site -O daw

# 2. App
git clone <repo> /var/www/daw-site && cd /var/www/daw-site
npm ci
cp .env.example .env   # set DATABASE_URL=postgresql://daw:PASS@localhost:5432/daw_site, SITE_URL, AUTH_SECRET, SMTP…
npm run db:use-postgres
npx prisma db push
npm run db:seed
npm run build

# 3. Run with a process manager
npm i -g pm2
pm2 start "npm run start" --name daw-site
pm2 save && pm2 startup
```

Put Nginx (or Caddy) in front for **HTTPS** (e.g. Let's Encrypt / certbot) and proxy to `localhost:3000`. Set `client_max_body_size 15m;` in Nginx so attachments up to 10 MB can be uploaded. Forward the client IP (`proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;`) so rate limiting works per visitor.

### Updating

```bash
git pull && npm ci && npx prisma db push && npm run build && pm2 restart daw-site
```

## 3. Email (SMTP)

Any SMTP provider works (Google Workspace, Microsoft 365, Zoho, Brevo, Mailgun, Amazon SES…).

```
SMTP_HOST="smtp.example.com"
SMTP_PORT="587"
SMTP_SECURE="false"        # "true" for port 465
SMTP_USER="no-reply@yourdomain.com"
SMTP_PASSWORD="…"
MAIL_FROM="Daw Zainelabideen <no-reply@yourdomain.com>"
```

**Current setup (aldaleel.ly, cPanel hosting):** `SMTP_HOST="mail.aldaleel.ly"`, `SMTP_PORT="465"`, `SMTP_SECURE="true"`, `SMTP_USER="training@aldaleel.ly"` — only `SMTP_PASSWORD` must be filled in (the mailbox password from cPanel → Email Accounts).

**Test it:**
- Command line: `npm run mail:test -- someone@example.com` (verifies login, then sends a test message).
- Dashboard: **Admin → Site settings → Email (SMTP) → Send test** (shows the exact error if something is wrong).
- Restart the site after any `.env` change.

Configure SPF/DKIM for your domain with your provider so emails aren't marked as spam. Emails sent: admin notification for every request, registration acknowledgement to the participant, newsletter confirmation (double opt-in).

## 4. Backups & restore

**What one backup holds**

| Part | Where | Needs |
|---|---|---|
| Every database table (website and platform), tested by a trial restore | `backups/full-<time>/` | `DATABASE_URL` |
| Files uploaded in the local dashboard | `backups/full-<time>/storage/` | — |
| Files of the online platform (course files and videos, question attachments, member documents, covers) | `backups/files/` | `SUPABASE_SECRET_KEY` |
| Supabase sign-in accounts | **not included** | — |

```powershell
npm.cmd run backup        # regular backup, keeps the latest 30 database backups
npm.cmd run backup:full   # before a change: same, and removes nothing
```

### Online files: add the secret key once

Do this yourself; never send the key to anyone and never commit it.

1. Supabase dashboard → project → **Project Settings → API Keys** → **Secret keys** → copy the key.
2. Open the `.env` file of the project and add the line `SUPABASE_SECRET_KEY="…your key…"`.
3. Run `npm.cmd run backup` and check the line starting with **Online files**.

This key can read and change all platform data. Without it the backup still saves the database and says clearly that the online files were not included. The files folder only grows: a file deleted online stays in the backup. Restoring files is manual (upload them again from the course page or the Supabase dashboard).

### Run it every day (Windows)

```powershell
powershell -ExecutionPolicy Bypass -File scripts\schedule-backup.ps1
```

Every day at 21:00 (`-Time 13:30` changes it, `-Remove` stops it). Results are added to `backups\backup.log`: read it from time to time. The computer must be switched on for the task to run.

On Linux: `0 2 * * * cd /var/www/daw-site && npm run backup >> backups/backup.log 2>&1`

**Keep a copy somewhere else.** A backup on the same disk is lost with the disk. Set `BACKUP_DIR` in `.env` to an external disk, or copy the `backups/` folder to private cloud storage. It holds personal data and password hashes.

### Restore plan

1. Stop the app if it is running.
2. Make a fresh backup of the current state (`npm run backup:full`).
3. Check the backup you want: `npm run backup:full -- --check backups/full-<time>`
4. Restore: `npm run restore -- backups/full-<time> --yes` — **replaces all data**.
5. Start the app and sign in to verify.

**Admin → Backup** in the local dashboard downloads one file with every table, without password hashes. Restore it the same way (`npm run restore -- file.json --yes`), then reset the dashboard passwords with `npm run admin:reset-password`.

Backups made before 2026-11-27 that hold the website tables only (`database.json`) are refused when the database has platform data, because they would delete it. Folders of that time also have a `full/` copy, which is used automatically.

## 5. Security checklist

- [x] HTTPS (via reverse proxy) + HSTS header
- [x] Passwords hashed with bcrypt (cost 12); sessions are signed JWTs in httpOnly, SameSite=Lax cookies (Secure in production)
- [x] Admin routes protected in middleware **and** every server action re-checks the role against the database
- [x] Login rate limiting (8 attempts / 15 min per IP) and failed logins logged
- [x] Forms: zod validation, honeypot field, minimum fill time, per-IP rate limit, consent checkbox
- [x] Uploads: allow-list of types, magic-byte sniffing, size limits, random filenames; request attachments stored privately and served only to staff
- [x] Markdown sanitized before rendering; JSON-LD escaped
- [x] Security headers: X-Content-Type-Options, X-Frame-Options, Referrer-Policy, Permissions-Policy
- [x] Audit log of admin activity
- [ ] Change the seeded admin password after first login
- [ ] If running several app instances behind a load balancer, move the in-memory rate limiter (`src/lib/spam.ts`) to Redis

## 6. Basic acceptance tests performed

- All public routes return 200 in Arabic and English; unknown routes return 404
- Registration, corporate request and newsletter (subscribe → confirm) tested end-to-end; validation errors preserve typed values
- Admin: login, create session, edit program (changes visible immediately on the public site), inboxes, CSV export, backup download
- Mobile (375 px) layout without horizontal overflow; RTL/LTR switching keeps the current page
- Production build and TypeScript check pass

## 7. Future LMS (e-learning) roadmap

The architecture is ready for an LMS module without rebuilding the site:

- **Already in place:** learner accounts (`User.role = LEARNER`), sign-in/sign-up, learner dashboard (`/[locale]/account`), registrations linked to users (`Registration.userId`), favorites, quiz engine (`Quiz` component + JSON questions), media storage, role-based admin.
- **To add:** Prisma models `Course`, `Module`, `Lesson` (video/file/text), `Enrollment`, `LessonProgress`, `QuestionBank`/`Question`/`Attempt`, `LiveSession` (Zoom/Teams link), `CompletionCertificate` (PDF generated with a verification code). Add pages under `src/app/[locale]/learn/…` and admin resources in `src/lib/admin-resources.ts` (the generic admin CRUD supports new models by configuration).
- **Certificates:** must be described as *program certificates of completion*, never as PMI certifications.

## 8. Things you need to provide

Real portrait photo · contact details (email, phone, WhatsApp, LinkedIn, address) · program durations/hours and session dates · optional CV PDF · real testimonials with consent · certificate scans/IDs (optional) · domain name, hosting and SMTP account · Google Analytics ID (optional).
