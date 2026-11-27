-- ─────────────────────────────────────────────────────────────────────────────
-- LMS · Course management — storage buckets.
-- Applied once with the project owner (Supabase connector / SQL editor): the application role cannot
-- manage storage. Safe to run again. Requires the functions of lms-courses.sql.
--
--   • "course-files" is PRIVATE: course documents and uploaded videos, read through links that expire.
--     Path = <programId>/<uuid>.<ext>, up to 50 MB (the free plan's limit per file).
--   • "course-covers" is PUBLIC: course cover images shown on the website.
-- ─────────────────────────────────────────────────────────────────────────────

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('course-files', 'course-files', false, 52428800, array[
  'application/pdf',
  'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv', 'text/plain', 'application/zip',
  'image/png', 'image/jpeg', 'image/webp', 'image/gif',
  'video/mp4', 'video/webm', 'audio/mpeg'])
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('course-covers', 'course-covers', true, 3145728, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update set
  public = true,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "course files: read" on storage.objects;
drop policy if exists "course files: upload" on storage.objects;
drop policy if exists "course files: delete" on storage.objects;
drop policy if exists "course covers: staff read" on storage.objects;
drop policy if exists "course covers: upload" on storage.objects;
drop policy if exists "course covers: delete" on storage.objects;

create policy "course files: read" on storage.objects for select to authenticated
  using (bucket_id = 'course-files' and public.exam_course_file_can(name, 'read'));

create policy "course files: upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'course-files' and public.exam_course_file_can(name, 'write'));

create policy "course files: delete" on storage.objects for delete to authenticated
  using (bucket_id = 'course-files' and public.exam_course_file_can(name, 'delete'));

-- reading a public bucket needs no policy; deleting through the API needs to see the row
create policy "course covers: staff read" on storage.objects for select to authenticated
  using (bucket_id = 'course-covers' and public.exam_course_cover_can(name));

create policy "course covers: upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'course-covers' and public.exam_course_cover_can(name));

create policy "course covers: delete" on storage.objects for delete to authenticated
  using (bucket_id = 'course-covers' and public.exam_course_cover_can(name));
