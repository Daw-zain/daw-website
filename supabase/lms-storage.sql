-- ─────────────────────────────────────────────────────────────────────────────
-- LMS · Phase 2 — private bucket for profile photos and certificates.
-- Applied once with the project owner (Supabase connector / SQL editor): the application role cannot
-- manage storage. Safe to run again. Paths: <memberId>/<uuid>.<ext>
-- Anonymous visitors have no policy at all.
-- ─────────────────────────────────────────────────────────────────────────────

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('member-files', 'member-files', false, 5242880, array['image/png', 'image/jpeg', 'image/webp', 'application/pdf'])
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "member files: read" on storage.objects;
drop policy if exists "member files: upload" on storage.objects;
drop policy if exists "member files: delete" on storage.objects;

create policy "member files: read" on storage.objects for select to authenticated
  using (bucket_id = 'member-files' and (public.exam_member_file_can(name, 'read') or public.exam_member_file_can(name, 'delete')));

create policy "member files: upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'member-files' and public.exam_member_file_can(name, 'write'));

create policy "member files: delete" on storage.objects for delete to authenticated
  using (bucket_id = 'member-files' and public.exam_member_file_can(name, 'delete'));
