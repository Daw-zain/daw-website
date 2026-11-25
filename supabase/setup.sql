-- ─────────────────────────────────────────────────────────────────────────────
-- Security rules for the public (GitHub Pages) site.
-- Run after the tables exist (npm run supabase:setup does both), and again after any schema change.
--
-- The browser uses the public "anon" key. With these rules a visitor can ONLY:
--   • submit a registration, consultation, corporate request, contact message or newsletter sign-up
--   • confirm / unsubscribe a newsletter address with its secret token
-- and can NOT read, change or delete anything (requests, users, password hashes, settings…).
-- The admin dashboard and the site build connect with the database password, which bypasses these rules.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Lock everything: no default access for browser roles, row-level security on every table.
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from anon, authenticated;
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke all on functions from anon, authenticated;

do $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t.tablename);
  end loop;
end $$;

-- 2. Insert-only access to the request tables, limited to the columns the forms send
--    (status, internal notes, attachments etc. keep their defaults and cannot be set by visitors).
grant insert ("id", "programId", "sessionId", "fullName", "email", "phone", "organization", "jobTitle", "city", "notes", "locale", "updatedAt")
  on public."Registration" to anon, authenticated;
grant insert ("id", "serviceId", "name", "email", "phone", "organization", "description", "contactMethod", "preferredDate", "locale", "updatedAt")
  on public."ConsultationRequest" to anon, authenticated;
grant insert ("id", "organization", "sector", "traineesCount", "programs", "mode", "duration", "contactName", "jobTitle", "email", "phone", "notes", "locale", "updatedAt")
  on public."CorporateRequest" to anon, authenticated;
grant insert ("id", "name", "email", "phone", "subject", "message", "locale", "updatedAt")
  on public."ContactMessage" to anon, authenticated;
grant insert ("id", "email", "token", "locale")
  on public."Subscriber" to anon, authenticated;

drop policy if exists "public insert" on public."Registration";
drop policy if exists "public insert" on public."ConsultationRequest";
drop policy if exists "public insert" on public."CorporateRequest";
drop policy if exists "public insert" on public."ContactMessage";
drop policy if exists "public insert" on public."Subscriber";

create policy "public insert" on public."Registration" for insert to anon, authenticated
  with check (char_length("fullName") <= 120 and char_length("email") <= 200 and coalesce(char_length("notes"), 0) <= 2000);
create policy "public insert" on public."ConsultationRequest" for insert to anon, authenticated
  with check (char_length("name") <= 120 and char_length("email") <= 200 and char_length("description") <= 3000);
create policy "public insert" on public."CorporateRequest" for insert to anon, authenticated
  with check (char_length("organization") <= 150 and char_length("email") <= 200 and coalesce(char_length("notes"), 0) <= 3000);
create policy "public insert" on public."ContactMessage" for insert to anon, authenticated
  with check (char_length("name") <= 120 and char_length("email") <= 200 and char_length("message") <= 5000);
create policy "public insert" on public."Subscriber" for insert to anon, authenticated
  with check (char_length("email") <= 200 and "token" ~ '^[a-f0-9]{48}$');

-- 3. Newsletter confirm / unsubscribe links (?action=…&token=…) without exposing the table.
create or replace function public.newsletter_action(p_token text, p_action text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare sub_id text;
begin
  if p_token !~ '^[a-f0-9]{48}$' or p_action not in ('confirm', 'unsubscribe') then
    return 'invalid';
  end if;
  select "id" into sub_id from public."Subscriber" where "token" = p_token;
  if sub_id is null then
    return 'invalid';
  end if;
  if p_action = 'confirm' then
    update public."Subscriber" set "confirmedAt" = coalesce("confirmedAt", now()), "unsubscribedAt" = null where "id" = sub_id;
    return 'confirmed';
  end if;
  update public."Subscriber" set "unsubscribedAt" = now() where "id" = sub_id;
  return 'unsubscribed';
end $$;

revoke all on function public.newsletter_action(text, text) from public;
grant execute on function public.newsletter_action(text, text) to anon, authenticated;
