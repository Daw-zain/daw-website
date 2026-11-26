-- ─────────────────────────────────────────────────────────────────────────────
-- Exam system · Phase 4 — private Storage bucket for question / scenario attachments.
-- Must run as the project owner (Supabase SQL editor or the Supabase connector), not as the app user:
-- it changes the storage schema. Safe to run again. Requires public.exam_storage_can() from exams-scenarios.sql.
--
--   • Bucket "exam-assets" is PRIVATE: no public URLs. Files are read through signed URLs that expire.
--   • Only images (png, jpeg, webp, gif) and PDF, up to 10 MB.
--   • Path = <programId>/<ownerId>/<file>; every policy checks the caller's rights on <programId>
--     through exam_storage_can() — staff of the course can read; editors of the course can write/delete.
--     Anonymous visitors have no policy at all.
-- ─────────────────────────────────────────────────────────────────────────────

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('exam-assets', 'exam-assets', false, 10485760, array['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/pdf'])
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "exam assets: staff read" on storage.objects;
drop policy if exists "exam assets: editors upload" on storage.objects;
drop policy if exists "exam assets: editors update" on storage.objects;
drop policy if exists "exam assets: editors delete" on storage.objects;

create policy "exam assets: staff read" on storage.objects for select to authenticated
  using (bucket_id = 'exam-assets' and public.exam_storage_can(name, 'read'));

create policy "exam assets: editors upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'exam-assets' and public.exam_storage_can(name, 'write'));

create policy "exam assets: editors update" on storage.objects for update to authenticated
  using (bucket_id = 'exam-assets' and public.exam_storage_can(name, 'write'))
  with check (bucket_id = 'exam-assets' and public.exam_storage_can(name, 'write'));

create policy "exam assets: editors delete" on storage.objects for delete to authenticated
  using (bucket_id = 'exam-assets' and public.exam_storage_can(name, 'write'));
