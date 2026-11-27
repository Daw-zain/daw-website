-- ─────────────────────────────────────────────────────────────────────────────
-- LMS · Course management — course data, files, educational videos and progress.
-- Applied by `npm run supabase:setup` after lms-people.sql (safe to run again).
--
-- Every course has three sections: files (MATERIAL), videos (VIDEO) and tests. The tests section is
-- the existing exam platform; nothing here duplicates it.
--
-- Who may do what (checked here, never only in the page):
--   • manage files and videos: super admin, an admin whose role has courses.content, or a trainer of
--     that course holding canManageContent.
--   • see everything including hidden items: the above, course staff, and admins with courses.read.
--   • trainees: published items in published folders of a course their subscription opens now,
--     including items another course shared with it.
-- Files live in the private bucket "course-files" (supabase/lms-courses-storage.sql).
-- ─────────────────────────────────────────────────────────────────────────────

do $$
declare t text;
begin
  foreach t in array array['CourseFolder', 'CourseItem', 'CourseItemVersion', 'ContentProgress'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;

-- the built-in Admin role manages courses, unless the super admin has already edited that role
update public."AdminRole" set "permissions" = "permissions" || '{"courses": ["read", "create", "update", "content"]}'::jsonb
where "key" = 'admin' and "updatedAt" = "createdAt" and not "permissions" ? 'courses';

-- ── helpers (not callable from the browser) ──

create or replace function public.lms_content_can_manage(p_program text)
returns boolean language sql stable security definer set search_path = public
as $$ select coalesce(public.exam_instructor_can(p_program, 'canManageContent'), false) $$;

create or replace function public.lms_content_is_staff(p_program text)
returns boolean language sql stable security definer set search_path = public
as $$
  select public.lms_content_can_manage(p_program)
      or coalesce(public.exam_course_access(p_program) in ('ADMIN', 'INSTRUCTOR'), false)
      or coalesce(public.exam_can('courses', 'read'), false)
$$;

-- does the caller's subscription open this course right now?
create or replace function public.lms_content_enrolled(p_program text)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public."Enrollment" e
                 where e."programId" = p_program and e."memberId" = (public.exam_current_member())."id" and public.exam_enrollment_open(e))
$$;

-- is this item visible to trainees at all (published, and not inside a hidden folder)?
create or replace function public.lms_item_live(i public."CourseItem")
returns boolean language sql stable security definer set search_path = public
as $$
  select i."published" and not exists (select 1 from public."CourseFolder" f where f."id" = i."folderId" and not f."published")
$$;

-- the courses through which the caller may open this item as a trainee
create or replace function public.lms_item_open_to_trainee(i public."CourseItem")
returns boolean language sql stable security definer set search_path = public
as $$
  select public.lms_item_live(i)
     and exists (select 1 from unnest(array_prepend(i."programId", coalesce(i."sharedWith", '{}'))) p where public.lms_content_enrolled(p))
$$;

-- content progress of one trainee in one course (own items plus items shared with the course)
create or replace function public.lms_content_progress(p_member text, p_program text)
returns jsonb language sql stable security definer set search_path = public
as $$
  with live as (
    select i."id" from public."CourseItem" i
    where (i."programId" = p_program or p_program = any(i."sharedWith")) and public.lms_item_live(i)
  ), mine as (
    select count(*)::int total,
           count(*) filter (where pr."completedAt" is not null)::int done,
           max(pr."lastAt") last
    from live left join public."ContentProgress" pr on pr."itemId" = live."id" and pr."memberId" = p_member
  )
  select jsonb_build_object('total', total, 'done', done, 'percent', case when total = 0 then 0 else (done * 100 / total) end, 'lastAt', last) from mine
$$;

create or replace function public.lms_text(p jsonb, p_key text, p_max int)
returns text language plpgsql immutable set search_path = public
as $$
declare v text := trim(coalesce(p ->> p_key, ''));
begin
  if char_length(v) > p_max then raise exception 'invalid_course: too_long'; end if;
  return v;
end $$;

create or replace function public.lms_valid_url(p text)
returns boolean language sql immutable set search_path = public
as $$ select coalesce(p ~* '^https://[^\s<>"'']+$' and char_length(p) <= 1000, false) $$;

-- ── course data ──

create or replace function public.exam_course_list()
returns jsonb language plpgsql stable security definer set search_path = public
as $$
begin
  perform public.exam_require('courses', 'read');
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'programId', p."id", 'slug', p."slug", 'code', p."code", 'titleAr', p."titleAr", 'titleEn', p."titleEn",
      'category', p."category", 'status', p."status", 'published', p."published", 'image', p."image",
      'files', (select count(*) from public."CourseItem" i where i."programId" = p."id" and i."section" = 'MATERIAL'),
      'videos', (select count(*) from public."CourseItem" i where i."programId" = p."id" and i."section" = 'VIDEO'),
      'questions', (select count(*) from public."Question" q where q."programId" = p."id"),
      'exams', (select count(*) from public."Exam" x where x."programId" = p."id"),
      'trainees', (select count(*) from public."Enrollment" e where e."programId" = p."id" and public.exam_enrollment_open(e)),
      'trainers', (select count(*) from public."CourseInstructor" ci join public."ExamMember" m on m."id" = ci."memberId" and m."role" <> 'LEARNER' and m."deletedAt" is null where ci."programId" = p."id")
    ) order by p."order", p."createdAt"), '[]'::jsonb)
    from public."Program" p);
end $$;

create or replace function public.exam_course_record(p_program text)
returns jsonb language plpgsql stable security definer set search_path = public
as $$
declare p public."Program";
begin
  perform public.exam_require('courses', 'read');
  select * into p from public."Program" where "id" = p_program;
  if p."id" is null then raise exception 'course_not_found' using errcode = 'P0002'; end if;
  return jsonb_build_object(
    'course', to_jsonb(p) - 'metaTitleAr' - 'metaTitleEn' - 'metaDescAr' - 'metaDescEn',
    'can', jsonb_build_object('update', public.exam_can('courses', 'update'), 'content', public.lms_content_can_manage(p_program),
                              'trainers', public.exam_can('trainers', 'update'), 'tests', public.exam_course_access(p_program) is not null),
    'trainers', (select coalesce(jsonb_agg(jsonb_build_object('id', m."id", 'name', m."name", 'email', m."email", 'active', m."active", 'canManageContent', ci."canManageContent") order by m."name"), '[]'::jsonb)
                 from public."CourseInstructor" ci join public."ExamMember" m on m."id" = ci."memberId"
                 where ci."programId" = p_program and m."role" <> 'LEARNER' and m."deletedAt" is null),
    'trainees', (select count(*) from public."Enrollment" e where e."programId" = p_program and public.exam_enrollment_open(e)),
    'candidates', case when public.exam_can('trainers', 'update') then (
        select coalesce(jsonb_agg(jsonb_build_object('email', m."email", 'name', m."name") order by m."name"), '[]'::jsonb)
        from public."ExamMember" m
        where m."role" = 'INSTRUCTOR' and m."active" and m."deletedAt" is null
          and not exists (select 1 from public."CourseInstructor" ci where ci."programId" = p_program and ci."memberId" = m."id"))
      else '[]'::jsonb end);
end $$;

-- create (p_program null) or edit a course. Courses are hidden or published, never deleted here.
create or replace function public.exam_course_save(p_program text, p_data jsonb)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  cur public."Program"; res public."Program";
  v_title_ar text; v_title_en text; v_slug text; v_code text; v_category text; v_status text; v_image text;
  v_published boolean; v_featured boolean; v_hours int; v_order int; v_id text; n int := 1; v_base text;
  d jsonb := coalesce(p_data, '{}'::jsonb);
begin
  if p_program is null then
    perform public.exam_require('courses', 'create');
  else
    perform public.exam_require('courses', 'update');
    select * into cur from public."Program" where "id" = p_program for update;
    if cur."id" is null then raise exception 'course_not_found' using errcode = 'P0002'; end if;
    -- keys that are not sent keep their value
    d := to_jsonb(cur) || d;
  end if;

  v_title_ar := public.lms_text(d, 'titleAr', 200);
  v_title_en := public.lms_text(d, 'titleEn', 200);
  if v_title_ar = '' or v_title_en = '' then raise exception 'invalid_course: title_missing'; end if;
  v_code := nullif(public.lms_text(d, 'code', 30), '');
  v_category := coalesce(nullif(d ->> 'category', ''), 'certification');
  if v_category not in ('certification', 'management', 'agile', 'technology', 'tools') then raise exception 'invalid_course: category'; end if;
  v_status := coalesce(nullif(d ->> 'status', ''), 'COMING_SOON');
  if v_status not in ('OPEN', 'COMING_SOON', 'ON_REQUEST', 'CLOSED') then raise exception 'invalid_course: status'; end if;
  v_published := coalesce((d ->> 'published')::boolean, false);
  v_featured := coalesce((d ->> 'featured')::boolean, false);
  if coalesce(d ->> 'hours', '') <> '' and (d ->> 'hours') !~ '^\d{1,4}$' then raise exception 'invalid_course: hours'; end if;
  v_hours := nullif(d ->> 'hours', '')::int;
  if coalesce(d ->> 'order', '') <> '' and (d ->> 'order') !~ '^\d{1,5}$' then raise exception 'invalid_course: order'; end if;
  v_order := coalesce(nullif(d ->> 'order', '')::int, 0);
  v_image := nullif(trim(coalesce(d ->> 'image', '')), '');
  if v_image is not null and v_image is distinct from cur."image" and not (public.lms_valid_url(v_image) or v_image ~ '^/[A-Za-z0-9_./-]+$') then
    raise exception 'invalid_course: image';
  end if;
  if v_published and (public.lms_text(d, 'summaryAr', 600) = '' or public.lms_text(d, 'summaryEn', 600) = '') then
    raise exception 'invalid_course: summary_missing';
  end if;

  v_slug := lower(public.lms_text(d, 'slug', 80));
  if v_slug <> '' and v_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then raise exception 'invalid_course: slug'; end if;
  if v_slug = '' then
    v_base := trim(both '-' from regexp_replace(lower(coalesce(v_code, v_title_en)), '[^a-z0-9]+', '-', 'g'));
    if v_base = '' then v_base := 'course'; end if;
    v_base := left(v_base, 60);
    v_slug := v_base;
    while exists (select 1 from public."Program" where "slug" = v_slug and "id" is distinct from p_program) loop
      n := n + 1; v_slug := v_base || '-' || n;
    end loop;
  elsif exists (select 1 from public."Program" where "slug" = v_slug and "id" is distinct from p_program) then
    raise exception 'invalid_course: slug_used';
  end if;

  if p_program is null then
    v_id := replace(gen_random_uuid()::text, '-', '');
    insert into public."Program" ("id", "slug", "titleAr", "titleEn", "summaryAr", "summaryEn", "descriptionAr", "descriptionEn", "published", "updatedAt")
    values (v_id, v_slug, v_title_ar, v_title_en, '', '', '', '', false, (now() at time zone 'utc'));
  else
    v_id := p_program;
  end if;

  update public."Program" set
    "slug" = v_slug, "code" = v_code, "category" = v_category,
    "titleAr" = v_title_ar, "titleEn" = v_title_en,
    "summaryAr" = public.lms_text(d, 'summaryAr', 600), "summaryEn" = public.lms_text(d, 'summaryEn', 600),
    "descriptionAr" = public.lms_text(d, 'descriptionAr', 8000), "descriptionEn" = public.lms_text(d, 'descriptionEn', 8000),
    "objectivesAr" = public.lms_text(d, 'objectivesAr', 5000), "objectivesEn" = public.lms_text(d, 'objectivesEn', 5000),
    "audienceAr" = public.lms_text(d, 'audienceAr', 3000), "audienceEn" = public.lms_text(d, 'audienceEn', 3000),
    "prerequisitesAr" = public.lms_text(d, 'prerequisitesAr', 3000), "prerequisitesEn" = public.lms_text(d, 'prerequisitesEn', 3000),
    "outlineAr" = public.lms_text(d, 'outlineAr', 8000), "outlineEn" = public.lms_text(d, 'outlineEn', 8000),
    "outcomesAr" = public.lms_text(d, 'outcomesAr', 5000), "outcomesEn" = public.lms_text(d, 'outcomesEn', 5000),
    "deliveryAr" = public.lms_text(d, 'deliveryAr', 500), "deliveryEn" = public.lms_text(d, 'deliveryEn', 500),
    "durationAr" = public.lms_text(d, 'durationAr', 100), "durationEn" = public.lms_text(d, 'durationEn', 100),
    "hours" = v_hours, "image" = v_image, "status" = v_status, "featured" = v_featured, "published" = v_published, "order" = v_order,
    "updatedAt" = (now() at time zone 'utc')
  where "id" = v_id returning * into res;

  perform public.exam_log(
    case when p_program is null then 'course.create' when cur."published" <> res."published" then case when res."published" then 'course.publish' else 'course.hide' end else 'course.update' end,
    'Program', v_id, v_id, jsonb_build_object('course', coalesce(res."code", res."slug"), 'published', res."published"));
  return jsonb_build_object('programId', v_id, 'slug', res."slug", 'published', res."published");
end $$;

-- ── files and videos ──

create or replace function public.lms_item_json(i public."CourseItem", p_staff boolean, p_member text)
returns jsonb language sql stable security definer set search_path = public
as $$
  select jsonb_build_object(
    'id', i."id", 'programId', i."programId", 'section', i."section", 'folderId', i."folderId",
    'titleAr', i."titleAr", 'titleEn', i."titleEn", 'descAr', i."descAr", 'descEn', i."descEn",
    'sortOrder', i."sortOrder", 'allowDownload', i."allowDownload", 'source', i."source",
    'url', i."url", 'videoRef', i."videoRef", 'filePath', i."filePath", 'fileName', i."fileName",
    'mimeType', i."mimeType", 'size', i."size", 'updatedAt', i."updatedAt",
    'progress', (select jsonb_build_object('percent', pr."percent", 'completed', pr."completedAt" is not null, 'positionSec', pr."positionSec", 'ranges', pr."ranges", 'durationSec', pr."durationSec")
                 from public."ContentProgress" pr where pr."itemId" = i."id" and pr."memberId" = p_member))
    || case when p_staff then jsonb_build_object('published', i."published", 'sharedWith', to_jsonb(coalesce(i."sharedWith", '{}')), 'version', i."version",
         'versions', (select coalesce(jsonb_agg(jsonb_build_object('version', v."version", 'fileName', v."fileName", 'filePath', v."filePath", 'size', v."size", 'replacedAt', v."replacedAt") order by v."version" desc), '[]'::jsonb)
                      from public."CourseItemVersion" v where v."itemId" = i."id")) else '{}'::jsonb end
$$;

-- the files and videos of one course, as the caller may see them
create or replace function public.exam_content(p_program text)
returns jsonb language plpgsql stable security definer set search_path = public
as $$
declare
  me public."ExamMember" := public.exam_current_member();
  v_staff boolean; v_manage boolean;
begin
  if me."id" is null then raise exception 'forbidden' using errcode = '42501'; end if;
  v_manage := public.lms_content_can_manage(p_program);
  v_staff := public.lms_content_is_staff(p_program);
  if not v_staff and not public.lms_content_enrolled(p_program) then raise exception 'forbidden' using errcode = '42501'; end if;
  if not exists (select 1 from public."Program" where "id" = p_program) then raise exception 'course_not_found' using errcode = 'P0002'; end if;

  return jsonb_build_object(
    'canManage', v_manage,
    'staff', v_staff,
    'canSeeProgress', v_staff and (v_manage or public.exam_instructor_can(p_program, 'canViewResults') or public.exam_can('trainees', 'update')),
    'progress', public.lms_content_progress(me."id", p_program),
    'folders', (select coalesce(jsonb_agg(jsonb_build_object('id', f."id", 'section', f."section", 'nameAr', f."nameAr", 'nameEn', f."nameEn", 'published', f."published", 'sortOrder', f."sortOrder")
                  order by f."sortOrder", f."createdAt", f."id"), '[]'::jsonb)
                from public."CourseFolder" f where f."programId" = p_program and (v_staff or f."published")),
    'items', (select coalesce(jsonb_agg(public.lms_item_json(i, v_staff, me."id") order by i."section", i."sortOrder", i."createdAt", i."id"), '[]'::jsonb)
              from public."CourseItem" i where i."programId" = p_program and (v_staff or public.lms_item_live(i))),
    -- items another course shared with this one (read only here)
    'shared', (select coalesce(jsonb_agg(public.lms_item_json(i, false, me."id") || jsonb_build_object('folderId', null, 'fromCode', coalesce(p."code", p."slug"))
                 order by i."section", p."order", i."sortOrder", i."createdAt"), '[]'::jsonb)
               from public."CourseItem" i join public."Program" p on p."id" = i."programId"
               where p_program = any(i."sharedWith") and i."programId" <> p_program and public.lms_item_live(i)),
    'courses', case when v_manage then (
        select coalesce(jsonb_agg(jsonb_build_object('programId', p."id", 'code', coalesce(p."code", p."slug"), 'titleAr', p."titleAr", 'titleEn', p."titleEn") order by p."order"), '[]'::jsonb)
        from public."Program" p where p."id" <> p_program and public.lms_content_can_manage(p."id"))
      else '[]'::jsonb end);
end $$;

create or replace function public.exam_content_folder_save(p_program text, p_data jsonb)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  me public."ExamMember" := public.exam_current_member();
  v_id text := nullif(p_data ->> 'id', ''); cur public."CourseFolder"; res public."CourseFolder";
  v_ar text; v_en text; v_section text := p_data ->> 'section';
begin
  if not public.lms_content_can_manage(p_program) then raise exception 'forbidden' using errcode = '42501'; end if;
  v_ar := public.lms_text(p_data, 'nameAr', 150); v_en := public.lms_text(p_data, 'nameEn', 150);
  if v_ar = '' and v_en = '' then raise exception 'invalid_content: title_missing'; end if;
  if v_id is null then
    if v_section is null or v_section not in ('MATERIAL', 'VIDEO') then raise exception 'invalid_content: section'; end if;
    if (select count(*) from public."CourseFolder" where "programId" = p_program) >= 200 then raise exception 'invalid_content: too_many'; end if;
    insert into public."CourseFolder" ("programId", "section", "nameAr", "nameEn", "published", "sortOrder")
    values (p_program, v_section, coalesce(nullif(v_ar, ''), v_en), v_en, coalesce((p_data ->> 'published')::boolean, true),
            (select coalesce(max("sortOrder"), 0) + 1 from public."CourseFolder" where "programId" = p_program and "section" = v_section))
    returning * into res;
  else
    select * into cur from public."CourseFolder" where "id" = v_id and "programId" = p_program;
    if cur."id" is null then raise exception 'not_found' using errcode = 'P0002'; end if;
    update public."CourseFolder" set "nameAr" = coalesce(nullif(v_ar, ''), v_en), "nameEn" = v_en,
      "published" = coalesce((p_data ->> 'published')::boolean, cur."published"), "updatedAt" = now()
    where "id" = v_id returning * into res;
  end if;
  perform public.exam_log('content.folder', 'CourseFolder', res."id", p_program, jsonb_build_object('name', res."nameAr", 'published', res."published"));
  return jsonb_build_object('id', res."id");
end $$;

-- removes the folder only; its items stay in the course without a folder (hidden ones stay hidden)
create or replace function public.exam_content_folder_delete(p_id text)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare f public."CourseFolder"; n int;
begin
  select * into f from public."CourseFolder" where "id" = p_id;
  if f."id" is null or not public.lms_content_can_manage(f."programId") then raise exception 'forbidden' using errcode = '42501'; end if;
  -- items of a hidden folder must not become visible by removing the folder
  update public."CourseItem" set "published" = "published" and f."published", "folderId" = null, "updatedAt" = now() where "folderId" = p_id;
  get diagnostics n = row_count;
  delete from public."CourseFolder" where "id" = p_id;
  perform public.exam_log('content.folder.delete', 'CourseFolder', p_id, f."programId", jsonb_build_object('name', f."nameAr", 'items', n));
  return jsonb_build_object('items', n);
end $$;

-- a stored file must sit under the course's own folder and not belong to another item
create or replace function public.lms_check_file(p_program text, p_data jsonb, p_item text)
returns void language plpgsql stable security definer set search_path = public
as $$
declare v_path text := coalesce(p_data ->> 'filePath', ''); v_size bigint;
begin
  if v_path !~ ('^' || regexp_replace(p_program, '[^A-Za-z0-9_-]', '', 'g') || '/[0-9a-f-]{36}\.[a-z0-9]{1,5}$') then raise exception 'invalid_content: file'; end if;
  if exists (select 1 from public."CourseItem" i where i."filePath" = v_path and i."id" is distinct from p_item)
     or exists (select 1 from public."CourseItemVersion" v where v."filePath" = v_path) then
    raise exception 'invalid_content: file';
  end if;
  if coalesce(p_data ->> 'size', '') !~ '^\d{1,9}$' then raise exception 'invalid_content: file'; end if;
  v_size := (p_data ->> 'size')::bigint;
  if v_size <= 0 or v_size > 52428800 then raise exception 'invalid_content: too_big'; end if;
end $$;

-- types a browser can show in the page; only these can be "view only"
create or replace function public.lms_previewable(p_mime text)
returns boolean language sql immutable set search_path = public
as $$ select coalesce(p_mime in ('application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'image/gif', 'video/mp4', 'video/webm', 'audio/mpeg'), false) $$;

create or replace function public.exam_content_item_save(p_program text, p_data jsonb)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  me public."ExamMember" := public.exam_current_member();
  d jsonb := coalesce(p_data, '{}'::jsonb);
  v_id text := nullif(p_data ->> 'id', ''); cur public."CourseItem"; res public."CourseItem";
  v_section text; v_source text; v_ar text; v_en text; v_url text := ''; v_ref text := ''; v_folder text;
  v_shared text[]; v_download boolean; v_published boolean; x text; v_mime text;
begin
  if not public.lms_content_can_manage(p_program) then raise exception 'forbidden' using errcode = '42501'; end if;
  if v_id is not null then
    select * into cur from public."CourseItem" where "id" = v_id and "programId" = p_program for update;
    if cur."id" is null then raise exception 'not_found' using errcode = 'P0002'; end if;
    d := to_jsonb(cur) || d;
    v_section := cur."section"; v_source := cur."source";
  else
    v_section := d ->> 'section'; v_source := coalesce(d ->> 'source', 'FILE');
    if v_section is null or v_section not in ('MATERIAL', 'VIDEO') then raise exception 'invalid_content: section'; end if;
    if v_source not in ('FILE', 'YOUTUBE', 'VIMEO', 'LINK') then raise exception 'invalid_content: source'; end if;
    if v_section = 'MATERIAL' and v_source not in ('FILE', 'LINK') then raise exception 'invalid_content: source'; end if;
    if (select count(*) from public."CourseItem" where "programId" = p_program) >= 1000 then raise exception 'invalid_content: too_many'; end if;
  end if;

  v_ar := public.lms_text(d, 'titleAr', 200); v_en := public.lms_text(d, 'titleEn', 200);
  if v_ar = '' and v_en = '' then raise exception 'invalid_content: title_missing'; end if;

  v_folder := nullif(d ->> 'folderId', '');
  if v_folder is not null and not exists (select 1 from public."CourseFolder" where "id" = v_folder and "programId" = p_program and "section" = v_section) then
    raise exception 'invalid_content: folder';
  end if;

  if v_source = 'YOUTUBE' then
    v_url := trim(coalesce(d ->> 'url', ''));
    v_ref := substring(v_url from '^https://(?:www\.|m\.)?(?:youtube\.com/(?:watch\?(?:[^#\s]*&)?v=|embed/|shorts/|live/)|youtu\.be/|youtube-nocookie\.com/embed/)([A-Za-z0-9_-]{11})(?:[?&#/].*)?$');
    if v_ref is null then raise exception 'invalid_content: youtube'; end if;
  elsif v_source = 'VIMEO' then
    v_url := trim(coalesce(d ->> 'url', ''));
    v_ref := substring(v_url from '^https://(?:www\.|player\.)?vimeo\.com/(?:video/)?([0-9]{5,12})(?:[?&#/].*)?$');
    if v_ref is null then raise exception 'invalid_content: vimeo'; end if;
  elsif v_source = 'LINK' then
    v_url := trim(coalesce(d ->> 'url', ''));
    if not public.lms_valid_url(v_url) then raise exception 'invalid_content: url'; end if;
  elsif v_id is null then
    perform public.lms_check_file(p_program, d, null);
    if v_section = 'VIDEO' and coalesce(d ->> 'mimeType', '') not in ('video/mp4', 'video/webm') then raise exception 'invalid_content: video_type'; end if;
  end if;

  v_mime := case when v_id is null then left(coalesce(d ->> 'mimeType', ''), 150) else cur."mimeType" end;
  v_download := coalesce((d ->> 'allowDownload')::boolean, v_section = 'MATERIAL');
  if v_source = 'FILE' and not v_download and not public.lms_previewable(v_mime) then raise exception 'invalid_content: view_only_type'; end if;
  v_published := coalesce((d ->> 'published')::boolean, true);

  -- sharing opens the item to another course's trainees: the caller must manage that course too
  v_shared := coalesce((select array_agg(distinct s) from jsonb_array_elements_text(
      case when jsonb_typeof(d -> 'sharedWith') = 'array' then d -> 'sharedWith' else '[]'::jsonb end) s where s <> p_program), '{}');
  foreach x in array v_shared loop
    if not (x = any(coalesce(cur."sharedWith", '{}'))) then
      if not exists (select 1 from public."Program" where "id" = x) or not public.lms_content_can_manage(x) then
        raise exception 'invalid_content: share';
      end if;
    end if;
  end loop;

  if v_id is null then
    insert into public."CourseItem" ("programId", "section", "source", "titleAr", "createdById", "sortOrder", "filePath", "fileName", "mimeType", "size")
    values (p_program, v_section, v_source, coalesce(nullif(v_ar, ''), v_en), me."id",
            (select coalesce(max("sortOrder"), 0) + 1 from public."CourseItem" where "programId" = p_program and "section" = v_section),
            case when v_source = 'FILE' then d ->> 'filePath' end,
            case when v_source = 'FILE' then left(coalesce(d ->> 'fileName', ''), 200) else '' end,
            case when v_source = 'FILE' then v_mime else '' end,
            case when v_source = 'FILE' then (d ->> 'size')::int else 0 end)
    returning "id" into v_id;
  end if;

  update public."CourseItem" set
    "folderId" = v_folder, "titleAr" = coalesce(nullif(v_ar, ''), v_en), "titleEn" = v_en,
    "descAr" = public.lms_text(d, 'descAr', 2000), "descEn" = public.lms_text(d, 'descEn', 2000),
    "allowDownload" = v_download, "published" = v_published, "sharedWith" = v_shared,
    "url" = v_url, "videoRef" = v_ref, "updatedAt" = now()
  where "id" = v_id returning * into res;

  -- a different video: what was watched of the old one no longer counts
  if cur."id" is not null and (cur."url" is distinct from res."url") and res."source" <> 'FILE' then
    delete from public."ContentProgress" where "itemId" = v_id;
  end if;

  perform public.exam_log(case when cur."id" is null then 'content.add' else 'content.update' end, 'CourseItem', v_id, p_program,
    jsonb_build_object('title', res."titleAr", 'section', res."section", 'published', res."published"));
  return jsonb_build_object('id', v_id);
end $$;

-- a new version of a file; the old one is kept for the staff
create or replace function public.exam_content_replace(p_id text, p_file jsonb)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare me public."ExamMember" := public.exam_current_member(); i public."CourseItem"; v_mime text := left(coalesce(p_file ->> 'mimeType', ''), 150);
begin
  select * into i from public."CourseItem" where "id" = p_id for update;
  if i."id" is null or not public.lms_content_can_manage(i."programId") then raise exception 'forbidden' using errcode = '42501'; end if;
  if i."source" <> 'FILE' then raise exception 'invalid_content: source'; end if;
  if (p_file ->> 'filePath') = i."filePath" then raise exception 'invalid_content: file'; end if;
  perform public.lms_check_file(i."programId", p_file, p_id);
  if i."section" = 'VIDEO' and v_mime not in ('video/mp4', 'video/webm') then raise exception 'invalid_content: video_type'; end if;
  if not i."allowDownload" and not public.lms_previewable(v_mime) then raise exception 'invalid_content: view_only_type'; end if;
  insert into public."CourseItemVersion" ("itemId", "version", "filePath", "fileName", "mimeType", "size", "replacedById")
  values (i."id", i."version", i."filePath", i."fileName", i."mimeType", i."size", me."id");
  update public."CourseItem" set "filePath" = p_file ->> 'filePath', "fileName" = left(coalesce(p_file ->> 'fileName', ''), 200), "mimeType" = v_mime,
    "size" = (p_file ->> 'size')::int, "version" = i."version" + 1, "updatedAt" = now() where "id" = p_id;
  -- a new video has to be watched again; a new file edition keeps the trainee's "opened" state
  if i."section" = 'VIDEO' then delete from public."ContentProgress" where "itemId" = p_id; end if;
  perform public.exam_log('content.replace', 'CourseItem', p_id, i."programId", jsonb_build_object('title', i."titleAr", 'version', i."version" + 1));
  return jsonb_build_object('version', i."version" + 1);
end $$;

-- deletes the item for good; returns the stored files the browser must remove
create or replace function public.exam_content_item_delete(p_id text)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare i public."CourseItem"; v_paths jsonb;
begin
  select * into i from public."CourseItem" where "id" = p_id for update;
  if i."id" is null or not public.lms_content_can_manage(i."programId") then raise exception 'forbidden' using errcode = '42501'; end if;
  select coalesce(jsonb_agg(p), '[]'::jsonb) into v_paths from (
    select i."filePath" p where i."filePath" is not null
    union select v."filePath" from public."CourseItemVersion" v where v."itemId" = p_id) s;
  perform public.exam_log('content.delete', 'CourseItem', p_id, i."programId", jsonb_build_object('title', i."titleAr", 'section', i."section"));
  delete from public."CourseItem" where "id" = p_id;
  return jsonb_build_object('paths', v_paths);
end $$;

-- move a folder or an item one place up or down among its neighbours
create or replace function public.exam_content_move(p_kind text, p_id text, p_up boolean)
returns void language plpgsql security definer set search_path = public
as $$
declare v_program text; v_section text; v_folder text; ids text[]; at int; other int; tmp text; k int;
begin
  if p_up is null then raise exception 'invalid_content: order'; end if;
  if p_kind = 'FOLDER' then
    select "programId", "section" into v_program, v_section from public."CourseFolder" where "id" = p_id;
  elsif p_kind = 'ITEM' then
    select "programId", "section", "folderId" into v_program, v_section, v_folder from public."CourseItem" where "id" = p_id;
  end if;
  if v_program is null or not public.lms_content_can_manage(v_program) then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_kind = 'FOLDER' then
    select array_agg("id" order by "sortOrder", "createdAt", "id") into ids from public."CourseFolder" where "programId" = v_program and "section" = v_section;
  else
    select array_agg("id" order by "sortOrder", "createdAt", "id") into ids from public."CourseItem"
    where "programId" = v_program and "section" = v_section and "folderId" is not distinct from v_folder;
  end if;
  at := array_position(ids, p_id);
  other := at + case when p_up then -1 else 1 end;
  if other < 1 or other > array_length(ids, 1) then return; end if;
  tmp := ids[at]; ids[at] := ids[other]; ids[other] := tmp;
  for k in 1 .. array_length(ids, 1) loop
    if p_kind = 'FOLDER' then update public."CourseFolder" set "sortOrder" = k where "id" = ids[k];
    else update public."CourseItem" set "sortOrder" = k where "id" = ids[k];
    end if;
  end loop;
end $$;

-- ── progress ──

-- the item the caller may open, or an error
create or replace function public.lms_item_for_caller(p_id text)
returns public."CourseItem" language plpgsql stable security definer set search_path = public
as $$
declare i public."CourseItem";
begin
  if (public.exam_current_member())."id" is null then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into i from public."CourseItem" where "id" = p_id;
  if i."id" is null or not (public.lms_content_is_staff(i."programId") or public.lms_item_open_to_trainee(i)) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return i;
end $$;

-- the trainee opened an item. A file counts as completed once opened; a video does not.
-- Staff previews are not recorded unless they are also enrolled in the course.
create or replace function public.exam_content_open(p_id text)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare me public."ExamMember" := public.exam_current_member(); i public."CourseItem" := public.lms_item_for_caller(p_id);
begin
  if not public.lms_item_open_to_trainee(i) then return jsonb_build_object('recorded', false); end if;
  insert into public."ContentProgress" ("itemId", "memberId", "opens", "completedAt", "percent")
  values (i."id", me."id", 1, case when i."section" = 'MATERIAL' then now() end, case when i."section" = 'MATERIAL' then 100 else 0 end)
  on conflict ("itemId", "memberId") do update set "opens" = "ContentProgress"."opens" + 1, "lastAt" = now(),
    "completedAt" = coalesce("ContentProgress"."completedAt", excluded."completedAt"), "percent" = greatest("ContentProgress"."percent", excluded."percent");
  return jsonb_build_object('recorded', true, 'completed', i."section" = 'MATERIAL');
end $$;

-- parts of a video that were played: [[from, to], …] in seconds. Merged here; 90% counts as watched.
-- The player in the trainee's browser reports this, so it shows engagement and is not proof.
create or replace function public.exam_content_watch(p_id text, p_ranges jsonb, p_duration int, p_position int default 0)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  me public."ExamMember" := public.exam_current_member(); i public."CourseItem" := public.lms_item_for_caller(p_id);
  pr public."ContentProgress"; v_all jsonb; r record; a numeric; b numeric; lo numeric; hi numeric; total numeric := 0; merged jsonb := '[]'::jsonb; v_pct int; v_dur int;
begin
  if i."section" <> 'VIDEO' or i."source" not in ('FILE', 'YOUTUBE') then raise exception 'invalid_content: source'; end if;
  if p_duration is null or p_duration < 1 or p_duration > 86400 then raise exception 'invalid_content: duration'; end if;
  if p_ranges is null or jsonb_typeof(p_ranges) <> 'array' or jsonb_array_length(p_ranges) > 200 then raise exception 'invalid_content: ranges'; end if;
  if exists (select 1 from jsonb_array_elements(p_ranges) e
             where case when jsonb_typeof(e) <> 'array' then true when jsonb_array_length(e) <> 2 then true
                        else jsonb_typeof(e -> 0) <> 'number' or jsonb_typeof(e -> 1) <> 'number' end) then
    raise exception 'invalid_content: ranges';
  end if;
  if not public.lms_item_open_to_trainee(i) then return jsonb_build_object('recorded', false); end if;

  insert into public."ContentProgress" ("itemId", "memberId") values (i."id", me."id") on conflict ("itemId", "memberId") do nothing;
  select * into pr from public."ContentProgress" where "itemId" = i."id" and "memberId" = me."id" for update;
  -- the first length reported is kept, so a later report cannot shrink the video to inflate the share watched
  v_dur := coalesce(pr."durationSec", p_duration);
  v_all := pr."ranges" || p_ranges;

  for r in
    select greatest(0, least((e ->> 0)::numeric, v_dur)) f, greatest(0, least((e ->> 1)::numeric, v_dur)) t
    from jsonb_array_elements(v_all) e order by 1, 2
  loop
    a := r.f; b := r.t;
    if b <= a then continue; end if;
    if lo is null then lo := a; hi := b;
    elsif a <= hi + 1 then hi := greatest(hi, b);
    else
      merged := merged || jsonb_build_array(jsonb_build_array(lo, hi)); total := total + (hi - lo); lo := a; hi := b;
    end if;
  end loop;
  if lo is not null then merged := merged || jsonb_build_array(jsonb_build_array(lo, hi)); total := total + (hi - lo); end if;

  v_pct := least(100, floor(total * 100 / v_dur))::int;
  update public."ContentProgress" set "ranges" = merged, "durationSec" = v_dur, "watchedSec" = round(total)::int, "percent" = greatest("percent", v_pct),
    "positionSec" = greatest(0, least(coalesce(p_position, 0), v_dur)), "lastAt" = now(),
    "completedAt" = coalesce("completedAt", case when greatest("percent", v_pct) >= 90 then now() end)
  where "id" = pr."id" returning * into pr;
  return jsonb_build_object('recorded', true, 'percent', pr."percent", 'completed', pr."completedAt" is not null);
end $$;

-- videos the platform cannot measure (Vimeo, external links): the trainee says they watched it
create or replace function public.exam_content_mark(p_id text, p_done boolean)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare me public."ExamMember" := public.exam_current_member(); i public."CourseItem" := public.lms_item_for_caller(p_id);
begin
  if i."section" <> 'VIDEO' or i."source" not in ('VIMEO', 'LINK') then raise exception 'invalid_content: source'; end if;
  if p_done is null then raise exception 'invalid_content: source'; end if;
  if not public.lms_item_open_to_trainee(i) then return jsonb_build_object('recorded', false); end if;
  insert into public."ContentProgress" ("itemId", "memberId", "percent", "completedAt")
  values (i."id", me."id", case when p_done then 100 else 0 end, case when p_done then now() end)
  on conflict ("itemId", "memberId") do update set "percent" = excluded."percent", "completedAt" = excluded."completedAt", "lastAt" = now();
  return jsonb_build_object('recorded', true, 'completed', p_done);
end $$;

-- who has opened and watched what in one course
create or replace function public.exam_content_report(p_program text)
returns jsonb language plpgsql stable security definer set search_path = public
as $$
begin
  if not (public.lms_content_is_staff(p_program)
          and (public.lms_content_can_manage(p_program) or public.exam_instructor_can(p_program, 'canViewResults') or public.exam_can('trainees', 'update'))) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'trainees', (select coalesce(jsonb_agg(jsonb_build_object('id', m."id", 'name', m."name", 'email', m."email", 'open', public.exam_enrollment_open(e),
                    'progress', public.lms_content_progress(m."id", p_program),
                    'videoSeconds', (select coalesce(sum(pr."watchedSec"), 0) from public."ContentProgress" pr join public."CourseItem" i on i."id" = pr."itemId"
                                     where pr."memberId" = m."id" and (i."programId" = p_program or p_program = any(i."sharedWith")))
                  ) order by m."name", m."email"), '[]'::jsonb)
                 from public."Enrollment" e join public."ExamMember" m on m."id" = e."memberId" and m."deletedAt" is null where e."programId" = p_program),
    'items', (select coalesce(jsonb_agg(jsonb_build_object('id', i."id", 'section', i."section", 'titleAr', i."titleAr", 'titleEn', i."titleEn", 'published', public.lms_item_live(i),
                  'openedBy', s.opened, 'completedBy', s.done, 'avgPercent', s.avg) order by i."section", i."sortOrder", i."createdAt"), '[]'::jsonb)
              from public."CourseItem" i
              cross join lateral (
                select count(*)::int opened, count(*) filter (where pr."completedAt" is not null)::int done, coalesce(round(avg(pr."percent")), 0)::int avg
                from public."ContentProgress" pr
                where pr."itemId" = i."id" and exists (select 1 from public."Enrollment" e where e."memberId" = pr."memberId" and e."programId" = p_program)) s
              where i."programId" = p_program));
end $$;

-- ── storage: called by the policies on the buckets (supabase/lms-courses-storage.sql) ──

-- course-files: <programId>/<uuid>.<ext>
create or replace function public.exam_course_file_can(p_name text, p_mode text)
returns boolean language plpgsql stable security definer set search_path = public
as $$
declare v_program text := split_part(p_name, '/', 1);
begin
  if (public.exam_current_member())."id" is null or v_program = '' then return false; end if;
  if p_mode in ('write', 'delete') then return public.lms_content_can_manage(v_program); end if;
  if public.lms_content_is_staff(v_program) then return true; end if;
  -- trainees: the current version of an item they may open (never earlier versions)
  return exists (select 1 from public."CourseItem" i where i."filePath" = p_name and public.lms_item_open_to_trainee(i));
end $$;

-- course-covers (public images of the website): only people who edit courses add or remove them
create or replace function public.exam_course_cover_can(p_name text)
returns boolean language plpgsql stable security definer set search_path = public
as $$
begin
  return coalesce(public.exam_can('courses', 'update') or public.exam_can('courses', 'create'), false)
     and exists (select 1 from public."Program" where "id" = split_part(p_name, '/', 1));
end $$;

-- ── Access ──
revoke all on function public.lms_content_can_manage(text) from public, anon, authenticated;
revoke all on function public.lms_content_is_staff(text) from public, anon, authenticated;
revoke all on function public.lms_content_enrolled(text) from public, anon, authenticated;
revoke all on function public.lms_item_live(public."CourseItem") from public, anon, authenticated;
revoke all on function public.lms_item_open_to_trainee(public."CourseItem") from public, anon, authenticated;
revoke all on function public.lms_content_progress(text, text) from public, anon, authenticated;
revoke all on function public.lms_text(jsonb, text, int) from public, anon, authenticated;
revoke all on function public.lms_valid_url(text) from public, anon, authenticated;
revoke all on function public.lms_item_json(public."CourseItem", boolean, text) from public, anon, authenticated;
revoke all on function public.lms_check_file(text, jsonb, text) from public, anon, authenticated;
revoke all on function public.lms_previewable(text) from public, anon, authenticated;
revoke all on function public.lms_item_for_caller(text) from public, anon, authenticated;

do $$
declare f text;
begin
  foreach f in array array[
    'exam_course_list()', 'exam_course_record(text)', 'exam_course_save(text, jsonb)', 'exam_content(text)',
    'exam_content_folder_save(text, jsonb)', 'exam_content_folder_delete(text)', 'exam_content_item_save(text, jsonb)',
    'exam_content_replace(text, jsonb)', 'exam_content_item_delete(text)', 'exam_content_move(text, text, boolean)',
    'exam_content_open(text)', 'exam_content_watch(text, jsonb, int, int)', 'exam_content_mark(text, boolean)', 'exam_content_report(text)',
    'exam_course_file_can(text, text)', 'exam_course_cover_can(text)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
