-- ─────────────────────────────────────────────────────────────────────────────
-- LMS · Phase 2 — trainees and trainers: lists, profiles, subscriptions and accounts.
-- Applied by `npm run supabase:setup` after lms-access.sql (safe to run again).
--
-- Accounts (create, password link, delete) need Supabase's administrator key, which only the server
-- function supabase/functions/lms-accounts holds. That function asks exam_account_check here, with the
-- CALLER's own session, before it does anything; the functions that write on its behalf
-- (lms_account_*) can be executed by that server role only.
-- ─────────────────────────────────────────────────────────────────────────────

do $$
declare t text;
begin
  foreach t in array array['MemberProfile', 'MemberQualification'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;

-- ── helpers ──

-- may the caller edit this person? Administrators are managed by the super admin only.
create or replace function public.exam_may_edit_member(p_target public."ExamMember")
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare me public."ExamMember" := public.exam_current_member();
begin
  if me."id" is null or p_target."id" is null or p_target."deletedAt" is not null then return false; end if;
  if me."role" = 'ADMIN' then return true; end if;
  if p_target."role" in ('ADMIN', 'STAFF') then return false; end if;
  if p_target."role" = 'INSTRUCTOR' then return public.exam_can('trainers', 'update'); end if;
  return public.exam_can('trainees', 'update');
end $$;

create or replace function public.exam_member_for_edit(p_member text)
returns public."ExamMember"
language plpgsql
stable
security definer
set search_path = public
as $$
declare t public."ExamMember";
begin
  if (public.exam_current_member())."id" is null then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into t from public."ExamMember" where "id" = p_member and "deletedAt" is null;
  if not coalesce(public.exam_may_edit_member(t), false) then
    -- someone without access learns nothing about whether the record exists
    if t."id" is null and public.exam_can('users', 'read') then raise exception 'member_not_found' using errcode = 'P0002'; end if;
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return t;
end $$;

-- a calendar date typed in Libya → the UTC instant it starts (or ends)
create or replace function public.exam_local_day(p_date text, p_end boolean)
returns timestamp
language plpgsql
immutable
set search_path = public
as $$
declare d date;
begin
  if nullif(trim(p_date), '') is null then return null; end if;
  if trim(p_date) !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'invalid_enrollment: date'; end if;
  d := trim(p_date)::date;
  return (((d + case when p_end then 1 else 0 end)::timestamp) at time zone 'Africa/Tripoli') at time zone 'utc';
end $$;

-- files of a profile (photo, certificates): the person, staff who see accounts, or whoever may edit them
create or replace function public.exam_member_file_can(p_name text, p_action text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare me public."ExamMember" := public.exam_current_member(); t public."ExamMember";
begin
  if me."id" is null then return false; end if;
  select * into t from public."ExamMember" where "id" = split_part(coalesce(p_name, ''), '/', 1);
  if t."id" is null then return false; end if;
  if p_action = 'read' then return me."id" = t."id" or public.exam_can('users', 'read'); end if;
  if p_action = 'write' then return coalesce(public.exam_may_edit_member(t), false); end if;
  -- removing files also happens after an account was deleted
  if p_action = 'delete' then return me."role" = 'ADMIN' or coalesce(public.exam_may_edit_member(t), false); end if;
  return false;
end $$;

-- ── lists ──
-- filter: {kind: trainee|trainer, q, programId, status: active|disabled, enrollment: ACTIVE|SUSPENDED|COMPLETED|CANCELLED|EXPIRED|NONE,
--          from, to (registration date), page, export}
create or replace function public.exam_people(p_filter jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  f jsonb := coalesce(p_filter, '{}'::jsonb);
  v_export boolean := coalesce((f ->> 'export')::boolean, false);
  v_page int := greatest(coalesce((f ->> 'page')::int, 1), 1);
  v_size int := 25;
  v_q text := nullif(trim(f ->> 'q'), '');
  v_prog text := nullif(f ->> 'programId', '');
  v_enr text := nullif(f ->> 'enrollment', '');
  v_kind text := coalesce(nullif(f ->> 'kind', ''), 'trainee');
  result jsonb;
begin
  perform public.exam_require('users', case when v_export then 'export' else 'read' end);
  perform public.exam_rate_hit('people', 120);
  if v_kind not in ('trainee', 'trainer') then raise exception 'invalid_enrollment: kind'; end if;
  if v_export then v_page := 1; v_size := 5000; end if;

  with m as (
    select x.* from public."ExamMember" x
    left join public."MemberProfile" p on p."memberId" = x."id"
    where x."deletedAt" is null
      and x."role" = case when v_kind = 'trainer' then 'INSTRUCTOR' else 'LEARNER' end
      and (v_q is null or x."name" ilike '%' || v_q || '%' or x."email" ilike '%' || v_q || '%' or p."phone" ilike '%' || v_q || '%')
      and (nullif(f ->> 'status', '') is null or x."active" = (f ->> 'status' = 'active'))
      and (nullif(f ->> 'from', '') is null or x."createdAt" >= public.exam_local_day(f ->> 'from', false))
      and (nullif(f ->> 'to', '') is null or x."createdAt" < public.exam_local_day(f ->> 'to', true))
      -- course and subscription state: a trainee by subscriptions, a trainer by assignments
      and (v_kind = 'trainer' or (v_prog is null and v_enr is null)
           or (v_enr = 'NONE' and not exists (select 1 from public."Enrollment" e where e."memberId" = x."id" and (v_prog is null or e."programId" = v_prog)))
           or (v_enr is distinct from 'NONE' and exists (
                 select 1 from public."Enrollment" e where e."memberId" = x."id" and (v_prog is null or e."programId" = v_prog)
                   and (v_enr is null
                        or (v_enr = 'EXPIRED' and e."status" = 'ACTIVE' and e."expiresAt" <= (now() at time zone 'utc'))
                        or (v_enr = 'ACTIVE' and public.exam_enrollment_open(e))
                        or (v_enr in ('SUSPENDED', 'COMPLETED', 'CANCELLED') and e."status" = v_enr)))))
      and (v_kind = 'trainee' or v_prog is null or exists (select 1 from public."CourseInstructor" c where c."memberId" = x."id" and c."programId" = v_prog))
  )
  select jsonb_build_object(
    'total', (select count(*) from m), 'page', v_page, 'pageSize', v_size,
    'items', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', x."id", 'name', x."name", 'email', x."email", 'active', x."active", 'createdAt', x."createdAt",
        'phone', coalesce(p."phone", ''), 'organization', coalesce(p."organization", ''), 'jobTitle', coalesce(p."jobTitle", ''), 'city', coalesce(p."city", ''),
        'specialties', coalesce(p."specialties", ''), 'experienceYears', p."experienceYears", 'photoPath', p."photoPath",
        'enrollments', (select coalesce(jsonb_agg(jsonb_build_object('programId', e."programId", 'code', coalesce(g."code", g."titleAr"), 'status', e."status",
                            'startsAt', e."startsAt", 'expiresAt', e."expiresAt", 'open', public.exam_enrollment_open(e)) order by g."order"), '[]'::jsonb)
                        from public."Enrollment" e join public."Program" g on g."id" = e."programId" where e."memberId" = x."id"),
        'courses', (select coalesce(jsonb_agg(coalesce(g."code", g."titleAr") order by g."order"), '[]'::jsonb)
                    from public."CourseInstructor" c join public."Program" g on g."id" = c."programId" where c."memberId" = x."id"),
        'attempts', (select count(*) from public."ExamAttempt" a where a."memberId" = x."id" and a."status" <> 'CANCELLED'),
        'lastAttemptAt', (select max(a."startedAt") from public."ExamAttempt" a where a."memberId" = x."id")
      ) order by x."createdAt" desc, x."id"), '[]'::jsonb)
      from (select * from m order by "createdAt" desc, "id" offset (v_page - 1) * v_size limit v_size) x
      left join public."MemberProfile" p on p."memberId" = x."id"))
  into result;

  if v_export then
    perform public.exam_log('member.export', 'ExamMember', null, v_prog, (f - 'export') || jsonb_build_object('count', result -> 'total'));
  end if;
  return result;
end $$;

-- one person: profile, qualifications, subscriptions with progress, attempts the caller may see, activity
create or replace function public.exam_member_record(p_member text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare me public."ExamMember" := public.exam_require('users', 'read'); t public."ExamMember"; v_edit boolean; v_courses text[]; v_open text;
begin
  perform public.exam_rate_hit('people', 120);
  select * into t from public."ExamMember" where "id" = p_member and "deletedAt" is null;
  if t."id" is null then raise exception 'member_not_found' using errcode = 'P0002'; end if;
  v_edit := coalesce(public.exam_may_edit_member(t), false);
  -- results are shown only for courses whose results the caller may view
  select coalesce(array_agg(g."id"), '{}') into v_courses from public."Program" g where public.exam_instructor_can(g."id", 'canViewResults');
  for v_open in select "id" from public."ExamAttempt" where "memberId" = t."id" and "status" = 'IN_PROGRESS' and "programId" = any(v_courses) loop
    perform public.exam_attempt_enforce_time(v_open);
  end loop;

  return jsonb_build_object(
    'member', jsonb_build_object('id', t."id", 'name', t."name", 'email', t."email", 'role', t."role", 'active', t."active", 'createdAt', t."createdAt"),
    'profile', coalesce((select to_jsonb(p) - 'memberId' - 'updatedById' - 'createdAt' - case when v_edit then '' else 'adminNotes' end
                         from public."MemberProfile" p where p."memberId" = t."id"), '{}'::jsonb),
    'qualifications', (select coalesce(jsonb_agg(to_jsonb(q) - 'memberId' order by q."year" desc nulls last, q."createdAt"), '[]'::jsonb)
                       from public."MemberQualification" q where q."memberId" = t."id"),
    'enrollments', (select coalesce(jsonb_agg(jsonb_build_object(
        'programId', e."programId", 'code', g."code", 'titleAr', g."titleAr", 'titleEn', g."titleEn", 'status', e."status",
        'startsAt', e."startsAt", 'expiresAt', e."expiresAt", 'open', public.exam_enrollment_open(e), 'since', e."createdAt",
        -- files and videos completed (supabase/lms-courses.sql)
        'content', public.lms_content_progress(t."id", e."programId"),
        -- progress in the course's published tests (null when the caller may not view its results)
        'progress', case when e."programId" = any(v_courses) then (
          select jsonb_build_object(
            'tests', (select count(*) from public."Exam" x where x."programId" = e."programId" and x."status" = 'PUBLISHED'),
            'taken', count(distinct a."examId") filter (where x."status" = 'PUBLISHED'),
            'passed', count(distinct a."examId") filter (where x."status" = 'PUBLISHED' and a."passed"),
            'attempts', count(*), 'avgPercent', round(avg(a."percent") filter (where not a."needsManual" and a."status" in ('COMPLETED', 'TIMED_OUT', 'ABANDONED')), 1),
            'mistakes', (select count(*) from public."MistakeItem" mi where mi."memberId" = t."id" and mi."programId" = e."programId" and mi."status" <> 'MASTERED'))
          from public."ExamAttempt" a join public."Exam" x on x."id" = a."examId"
          where a."memberId" = t."id" and a."programId" = e."programId" and a."status" <> 'CANCELLED') end
      ) order by g."order"), '[]'::jsonb)
      from public."Enrollment" e join public."Program" g on g."id" = e."programId" where e."memberId" = t."id"),
    'instructing', (select coalesce(jsonb_agg((to_jsonb(c) - 'id' - 'memberId' - 'createdAt' - 'updatedAt')
                      || jsonb_build_object('code', g."code", 'titleAr', g."titleAr", 'titleEn', g."titleEn") order by g."order"), '[]'::jsonb)
                    from public."CourseInstructor" c join public."Program" g on g."id" = c."programId" where c."memberId" = t."id"),
    'attempts', (select coalesce(jsonb_agg(x.j order by x.s desc), '[]'::jsonb) from (
        select a."startedAt" s, jsonb_build_object('id', a."id", 'examId', a."examId", 'titleAr', ex."titleAr", 'titleEn', ex."titleEn", 'code', g."code",
          'attemptNo', a."attemptNo", 'status', a."status", 'startedAt', a."startedAt", 'submittedAt', a."submittedAt",
          'percent', case when a."needsManual" then null else a."percent" end, 'passed', a."passed", 'warnings', a."warnings") j
        from public."ExamAttempt" a join public."Exam" ex on ex."id" = a."examId" join public."Program" g on g."id" = a."programId"
        where a."memberId" = t."id" and a."programId" = any(v_courses) order by a."startedAt" desc limit 500) x),
    'hiddenAttempts', (select count(*) from public."ExamAttempt" a where a."memberId" = t."id" and not a."programId" = any(v_courses)),
    'activity', case when public.exam_can('audit', 'read') then (
        select coalesce(jsonb_agg(x.j order by x.s desc), '[]'::jsonb) from (
          select l."createdAt" s, jsonb_build_object('at', l."createdAt", 'action', l."action", 'details', l."details", 'byThem', l."actorId" = t."id",
            'actorName', a."name", 'actorEmail', a."email", 'course', coalesce(g."code", g."titleAr")) j
          from public."ExamAuditLog" l
          left join public."ExamMember" a on a."id" = l."actorId"
          left join public."Program" g on g."id" = l."programId"
          where l."actorId" = t."id" or l."entityId" = t."id" or l."details" ->> 'email' = t."email"
          order by l."createdAt" desc limit 50) x) end,
    'can', jsonb_build_object(
      'edit', v_edit,
      'enroll', public.exam_can('trainees', 'update'),
      'trainer', public.exam_can('trainers', 'update') and (me."role" = 'ADMIN' or (t."role" not in ('ADMIN', 'STAFF') and t."id" <> me."id")),
      'status', public.exam_can('users', 'update') and t."id" <> me."id" and (me."role" = 'ADMIN' or t."role" not in ('ADMIN', 'STAFF')),
      'link', public.exam_may_send_link(t),
      'delete', me."role" = 'ADMIN' and t."id" <> me."id"));
end $$;

-- ── profile ──

create or replace function public.exam_profile_save(p_member text, p_data jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  t public."ExamMember" := public.exam_member_for_edit(p_member);
  me public."ExamMember" := public.exam_current_member();
  d jsonb := coalesce(p_data, '{}'::jsonb);
  v_name text := trim(coalesce(d ->> 'name', t."name"));
  v_years int; k text; v_max int; p public."MemberProfile";
begin
  if v_name = '' or char_length(v_name) > 120 then raise exception 'invalid_profile: name'; end if;
  foreach k in array array['phone', 'organization', 'jobTitle', 'city', 'bioAr', 'bioEn', 'specialties', 'adminNotes'] loop
    v_max := case when k in ('bioAr', 'bioEn', 'specialties', 'adminNotes') then 3000 else 150 end;
    if char_length(coalesce(d ->> k, '')) > v_max then raise exception 'invalid_profile: too_long'; end if;
  end loop;
  if coalesce(d ->> 'phone', '') !~ '^[0-9+() .-]{0,30}$' then raise exception 'invalid_profile: phone'; end if;
  if nullif(d ->> 'experienceYears', '') is not null then
    if d ->> 'experienceYears' !~ '^\d{1,2}$' then raise exception 'invalid_profile: experience'; end if;
    v_years := (d ->> 'experienceYears')::int;
  end if;

  insert into public."MemberProfile" ("memberId") values (t."id") on conflict ("memberId") do nothing;
  -- a field that is not sent keeps its value
  update public."MemberProfile" x set
    "phone" = trim(coalesce(d ->> 'phone', x."phone")), "organization" = trim(coalesce(d ->> 'organization', x."organization")),
    "jobTitle" = trim(coalesce(d ->> 'jobTitle', x."jobTitle")), "city" = trim(coalesce(d ->> 'city', x."city")),
    "bioAr" = trim(coalesce(d ->> 'bioAr', x."bioAr")), "bioEn" = trim(coalesce(d ->> 'bioEn', x."bioEn")),
    "specialties" = trim(coalesce(d ->> 'specialties', x."specialties")),
    "experienceYears" = case when d ? 'experienceYears' then v_years else x."experienceYears" end,
    "adminNotes" = trim(coalesce(d ->> 'adminNotes', x."adminNotes")),
    "updatedById" = me."id", "updatedAt" = now()
  where x."memberId" = t."id" returning * into p;
  update public."ExamMember" set "name" = v_name, "updatedAt" = now() where "id" = t."id";
  perform public.exam_log('member.profile', 'ExamMember', t."id", null, jsonb_build_object('email', t."email"));
  return to_jsonb(p);
end $$;

-- set or clear the photo; returns the previous file so the browser can remove it
create or replace function public.exam_member_photo(p_member text, p_path text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare t public."ExamMember" := public.exam_member_for_edit(p_member); v_old text;
begin
  if p_path is not null and (split_part(p_path, '/', 1) <> t."id" or p_path !~ '^[A-Za-z0-9-]+/[A-Za-z0-9-]+\.(png|jpg|jpeg|webp)$') then
    raise exception 'invalid_profile: file';
  end if;
  insert into public."MemberProfile" ("memberId") values (t."id") on conflict ("memberId") do nothing;
  select "photoPath" into v_old from public."MemberProfile" where "memberId" = t."id" for update;
  update public."MemberProfile" set "photoPath" = p_path, "updatedAt" = now() where "memberId" = t."id";
  perform public.exam_log('member.photo', 'ExamMember', t."id", null, jsonb_build_object('email', t."email", 'removed', p_path is null));
  return jsonb_build_object('previous', v_old);
end $$;

create or replace function public.exam_qualification_save(p_member text, p_data jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  t public."ExamMember" := public.exam_member_for_edit(p_member);
  d jsonb := coalesce(p_data, '{}'::jsonb);
  v_id text := nullif(d ->> 'id', '');
  v_ar text := trim(coalesce(d ->> 'titleAr', ''));
  v_en text := trim(coalesce(d ->> 'titleEn', ''));
  v_path text := nullif(d ->> 'filePath', '');
  v_year int; cur public."MemberQualification"; res public."MemberQualification";
begin
  if v_ar = '' and v_en = '' then raise exception 'invalid_profile: title'; end if;
  if char_length(v_ar) > 200 or char_length(v_en) > 200 or char_length(coalesce(d ->> 'issuer', '')) > 200
     or char_length(coalesce(d ->> 'credential', '')) > 100 or char_length(coalesce(d ->> 'fileName', '')) > 200 then
    raise exception 'invalid_profile: too_long';
  end if;
  if coalesce(d ->> 'kind', 'QUALIFICATION') not in ('QUALIFICATION', 'CERTIFICATE') then raise exception 'invalid_profile: kind'; end if;
  if nullif(d ->> 'year', '') is not null then
    if d ->> 'year' !~ '^(19|20)\d{2}$' then raise exception 'invalid_profile: year'; end if;
    v_year := (d ->> 'year')::int;
  end if;
  if v_path is not null and (split_part(v_path, '/', 1) <> t."id" or v_path !~ '^[A-Za-z0-9-]+/[A-Za-z0-9-]+\.(png|jpg|jpeg|webp|pdf)$') then
    raise exception 'invalid_profile: file';
  end if;
  if v_id is null then
    if (select count(*) from public."MemberQualification" where "memberId" = t."id") >= 40 then raise exception 'invalid_profile: too_many'; end if;
    insert into public."MemberQualification" ("memberId", "kind", "titleAr", "titleEn", "issuer", "year", "credential", "filePath", "fileName")
    values (t."id", coalesce(d ->> 'kind', 'QUALIFICATION'), v_ar, v_en, trim(coalesce(d ->> 'issuer', '')), v_year, trim(coalesce(d ->> 'credential', '')), v_path, coalesce(d ->> 'fileName', ''))
    returning * into res;
  else
    select * into cur from public."MemberQualification" where "id" = v_id and "memberId" = t."id" for update;
    if cur."id" is null then raise exception 'not_found' using errcode = 'P0002'; end if;
    update public."MemberQualification" set "kind" = coalesce(d ->> 'kind', "kind"), "titleAr" = v_ar, "titleEn" = v_en, "issuer" = trim(coalesce(d ->> 'issuer', '')),
      "year" = v_year, "credential" = trim(coalesce(d ->> 'credential', '')), "filePath" = case when d ? 'filePath' then v_path else "filePath" end,
      "fileName" = case when d ? 'filePath' then coalesce(d ->> 'fileName', '') else "fileName" end
    where "id" = v_id returning * into res;
  end if;
  perform public.exam_log('member.qualification', 'ExamMember', t."id", null, jsonb_build_object('email', t."email", 'title', coalesce(nullif(v_ar, ''), v_en)));
  return to_jsonb(res) || jsonb_build_object('previous', case when cur."filePath" is distinct from res."filePath" then cur."filePath" end);
end $$;

create or replace function public.exam_qualification_delete(p_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare q public."MemberQualification"; t public."ExamMember";
begin
  select * into q from public."MemberQualification" where "id" = p_id;
  if q."id" is null then
    perform public.exam_require('users', 'read');
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  t := public.exam_member_for_edit(q."memberId");
  delete from public."MemberQualification" where "id" = p_id;
  perform public.exam_log('member.qualification_delete', 'ExamMember', t."id", null, jsonb_build_object('email', t."email", 'title', coalesce(nullif(q."titleAr", ''), q."titleEn")));
  return jsonb_build_object('previous', q."filePath");
end $$;

-- ── subscriptions ──
-- one course for one or many people. data: {status, startsAt, expiresAt} (dates; "" clears; absent keeps)
create or replace function public.exam_enrollment_set(p_members jsonb, p_program text, p_data jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me public."ExamMember" := public.exam_require('trainees', 'update');
  d jsonb := coalesce(p_data, '{}'::jsonb);
  v_status text := nullif(d ->> 'status', '');
  v_from timestamp := public.exam_local_day(d ->> 'startsAt', false);
  v_to timestamp := public.exam_local_day(d ->> 'expiresAt', true);
  v_ids text[]; v_id text; t public."ExamMember"; en public."Enrollment"; v_done int := 0; v_missing int := 0;
begin
  if v_status is not null and v_status not in ('ACTIVE', 'SUSPENDED', 'COMPLETED', 'CANCELLED') then raise exception 'invalid_status' using errcode = '22023'; end if;
  if not exists (select 1 from public."Program" where "id" = p_program) then raise exception 'course_not_found' using errcode = 'P0002'; end if;
  if coalesce(jsonb_typeof(p_members), '') <> 'array' then raise exception 'invalid_enrollment: members'; end if;
  select coalesce(array_agg(distinct x), '{}') into v_ids from jsonb_array_elements_text(p_members) x;
  if cardinality(v_ids) = 0 or cardinality(v_ids) > 200 then raise exception 'invalid_enrollment: max_200'; end if;

  foreach v_id in array v_ids loop
    select * into t from public."ExamMember" where "id" = v_id and "deletedAt" is null;
    if t."id" is null then v_missing := v_missing + 1; continue; end if;
    select * into en from public."Enrollment" where "programId" = p_program and "memberId" = t."id" for update;
    if en."id" is null then
      if v_status = 'CANCELLED' then continue; end if;
      insert into public."Enrollment" ("programId", "memberId", "status", "startsAt", "expiresAt", "createdById")
      values (p_program, t."id", coalesce(v_status, 'ACTIVE'), v_from, v_to, me."id") returning * into en;
    else
      update public."Enrollment" set "status" = coalesce(v_status, "status"),
        "startsAt" = case when d ? 'startsAt' then v_from else "startsAt" end,
        "expiresAt" = case when d ? 'expiresAt' then v_to else "expiresAt" end, "updatedAt" = now()
      where "id" = en."id" returning * into en;
    end if;
    if en."startsAt" is not null and en."expiresAt" is not null and en."expiresAt" <= en."startsAt" then
      raise exception 'invalid_enrollment: dates';
    end if;
    perform public.exam_log('enrollment.set', 'Enrollment', en."id", p_program,
      jsonb_strip_nulls(jsonb_build_object('email', t."email", 'status', en."status", 'startsAt', en."startsAt", 'expiresAt', en."expiresAt")));
    v_done := v_done + 1;
  end loop;
  return jsonb_build_object('done', v_done, 'missing', v_missing);
end $$;

-- ── accounts: authorisation (called with the caller's own session) ──

-- may the caller receive a password link for this person? (a link gives control of the account)
create or replace function public.exam_may_send_link(p_target public."ExamMember")
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare me public."ExamMember" := public.exam_current_member(); c public."CourseInstructor"; k text;
begin
  if me."id" is null or p_target."id" is null or p_target."deletedAt" is not null then return false; end if;
  if me."role" = 'ADMIN' then return true; end if;
  if not public.exam_can('users', 'update') or p_target."id" = me."id" or p_target."role" in ('ADMIN', 'STAFF') then return false; end if;
  if p_target."role" = 'INSTRUCTOR' and not public.exam_can('trainers', 'update') then return false; end if;
  -- never a way to reach course permissions the caller does not hold (a trainee's old assignments included)
  for c in select * from public."CourseInstructor" where "memberId" = p_target."id" loop
    for k in select key from jsonb_each(to_jsonb(c)) where key like 'can%' and value = 'true'::jsonb loop
      if not public.exam_instructor_can(c."programId", k) then return false; end if;
    end loop;
  end loop;
  return true;
end $$;

create or replace function public.exam_valid_email(p text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select coalesce(p ~ '^[^@\s,;<>"]{1,64}@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$' and char_length(p) <= 200, false)
$$;

-- action: create {email, role} | link {memberId} | delete {memberId}
create or replace function public.exam_account_check(p_action text, p_data jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me public."ExamMember" := public.exam_current_member();
  d jsonb := coalesce(p_data, '{}'::jsonb);
  t public."ExamMember"; v_email text; v_role text;
begin
  if me."id" is null then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_action = 'create' then
    perform public.exam_require('users', 'create');
    perform public.exam_rate_hit('account_create', 600);
    v_email := lower(trim(coalesce(d ->> 'email', '')));
    v_role := coalesce(nullif(d ->> 'role', ''), 'LEARNER');
    if v_role not in ('LEARNER', 'INSTRUCTOR') then raise exception 'invalid_account: role'; end if;
    if v_role = 'INSTRUCTOR' then perform public.exam_require('trainers', 'update'); end if;
    if not public.exam_valid_email(v_email) then raise exception 'invalid_account: email'; end if;
    if exists (select 1 from public."ExamMember" where "email" = v_email) then raise exception 'invalid_account: already_member'; end if;
    return jsonb_build_object('actor', me."id", 'email', v_email, 'role', v_role);
  elsif p_action in ('link', 'delete') then
    perform public.exam_rate_hit('account', 60);
    select * into t from public."ExamMember" where "id" = d ->> 'memberId' and "deletedAt" is null;
    if p_action = 'link' then
      if not coalesce(public.exam_may_send_link(t), false) then raise exception 'forbidden' using errcode = '42501'; end if;
      perform public.exam_log('member.password_link', 'ExamMember', t."id", null, jsonb_build_object('email', t."email"));
    else
      if me."role" <> 'ADMIN' then raise exception 'super_admin_only' using errcode = '42501'; end if;
      if t."id" is null then raise exception 'member_not_found' using errcode = 'P0002'; end if;
      if t."id" = me."id" then raise exception 'cannot_disable_self' using errcode = '42501'; end if;
      if lower(trim(coalesce(d ->> 'confirm', ''))) <> t."email" then raise exception 'invalid_account: confirm'; end if;
    end if;
    return jsonb_build_object('actor', me."id", 'memberId', t."id", 'email', t."email", 'authUserId', t."authUserId");
  end if;
  raise exception 'invalid_account: action';
end $$;

-- a whole list before importing: what would happen to each row. items: [{email, name, course}]
create or replace function public.exam_people_import_check(p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  it jsonb; i bigint; v_email text; v_name text; v_course text; v_prog text; v_problem text; seen text[] := '{}'; out jsonb := '[]'::jsonb; m public."ExamMember";
begin
  perform public.exam_require('users', 'create');
  perform public.exam_rate_hit('people_import', 30);
  if coalesce(jsonb_typeof(p_items), '') <> 'array' then raise exception 'invalid_account: items'; end if;
  if jsonb_array_length(p_items) > 500 then raise exception 'invalid_account: max_500'; end if;
  for it, i in select x, n from jsonb_array_elements(p_items) with ordinality t(x, n) loop
    v_email := lower(trim(coalesce(it ->> 'email', '')));
    v_name := trim(coalesce(it ->> 'name', ''));
    v_course := trim(coalesce(it ->> 'course', ''));
    v_prog := null; m := null;
    if v_course <> '' then
      select "id" into v_prog from public."Program" where lower("code") = lower(v_course) or lower("slug") = lower(v_course) order by "order" limit 1;
    end if;
    select * into m from public."ExamMember" where "email" = v_email;
    v_problem := case
      when not public.exam_valid_email(v_email) then 'email'
      when v_name = '' or char_length(v_name) > 120 then 'name'
      when v_email = any(seen) then 'duplicate'
      when v_course <> '' and v_prog is null then 'course'
      when coalesce(it ->> 'phone', '') !~ '^[0-9+() .-]{0,30}$' then 'phone'
      when m."id" is not null and (m."deletedAt" is not null or m."role" <> 'LEARNER') then 'not_trainee'
      when m."id" is not null and v_prog is null then 'already_member'
    end;
    seen := seen || v_email;
    out := out || jsonb_build_object('row', i, 'email', v_email, 'programId', v_prog, 'problem', v_problem,
      -- an existing trainee is only added to the course
      'memberId', case when v_problem is null then m."id" end);
  end loop;
  return out;
end $$;

-- ── accounts: writes on behalf of the server function (service role only) ──

create or replace function public.lms_account_provision(p_actor text, p_auth_id text, p_email text, p_role text, p_data jsonb)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare d jsonb := coalesce(p_data, '{}'::jsonb); v_id text; v_name text := trim(coalesce(d ->> 'name', '')); v_email text := lower(trim(p_email));
begin
  if not exists (select 1 from public."ExamMember" where "id" = p_actor and "active") then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_role not in ('LEARNER', 'INSTRUCTOR') then raise exception 'invalid_account: role'; end if;
  if coalesce(p_auth_id, '') = '' or not public.exam_valid_email(v_email) then raise exception 'invalid_account: email'; end if;
  if exists (select 1 from public."ExamMember" where "email" = v_email or "authUserId" = p_auth_id) then raise exception 'invalid_account: already_member'; end if;
  insert into public."ExamMember" ("authUserId", "email", "name", "role")
  values (p_auth_id, v_email, coalesce(nullif(left(v_name, 120), ''), split_part(v_email, '@', 1)), p_role) returning "id" into v_id;
  insert into public."MemberProfile" ("memberId", "phone", "organization", "jobTitle", "city", "updatedById")
  values (v_id, case when coalesce(d ->> 'phone', '') ~ '^[0-9+() .-]{0,30}$' then trim(coalesce(d ->> 'phone', '')) else '' end,
    left(trim(coalesce(d ->> 'organization', '')), 150), left(trim(coalesce(d ->> 'jobTitle', '')), 150), left(trim(coalesce(d ->> 'city', '')), 150), p_actor);
  insert into public."ExamAuditLog" ("actorId", "action", "entity", "entityId", "details")
  values (p_actor, 'member.create', 'ExamMember', v_id, jsonb_build_object('email', v_email, 'role', p_role));
  return v_id;
end $$;

-- the sign-in of a member had to be created again
create or replace function public.lms_account_relink(p_actor text, p_member text, p_auth_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public."ExamMember" where "id" = p_actor and "active") or coalesce(p_auth_id, '') = '' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  update public."ExamMember" set "authUserId" = p_auth_id, "updatedAt" = now() where "id" = p_member and "deletedAt" is null;
  if not found then raise exception 'member_not_found' using errcode = 'P0002'; end if;
  insert into public."ExamAuditLog" ("actorId", "action", "entity", "entityId", "details")
  values (p_actor, 'member.relink', 'ExamMember', p_member, null);
end $$;

-- "delete account": personal data goes, results stay (without a name). Returns the files to remove.
create or replace function public.lms_account_erase(p_actor text, p_member text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare t public."ExamMember"; v_paths jsonb;
begin
  if not exists (select 1 from public."ExamMember" where "id" = p_actor and "active" and "role" = 'ADMIN') then
    raise exception 'super_admin_only' using errcode = '42501';
  end if;
  select * into t from public."ExamMember" where "id" = p_member and "deletedAt" is null for update;
  if t."id" is null then raise exception 'member_not_found' using errcode = 'P0002'; end if;
  if t."id" = p_actor then raise exception 'cannot_disable_self' using errcode = '42501'; end if;
  select coalesce(jsonb_agg(x), '[]'::jsonb) into v_paths from (
    select "photoPath" x from public."MemberProfile" where "memberId" = t."id" and "photoPath" is not null
    union all select "filePath" from public."MemberQualification" where "memberId" = t."id" and "filePath" is not null) f;
  delete from public."MemberProfile" where "memberId" = t."id";
  delete from public."MemberQualification" where "memberId" = t."id";
  delete from public."CourseInstructor" where "memberId" = t."id";
  update public."Enrollment" set "status" = 'CANCELLED', "updatedAt" = now() where "memberId" = t."id";
  update public."ExamMember" set "email" = 'deleted-' || t."id" || '@deleted.invalid', "name" = 'حساب محذوف', "role" = 'LEARNER', "adminRoleId" = null,
    "active" = false, "deletedAt" = now(), "updatedAt" = now() where "id" = t."id";
  insert into public."ExamAuditLog" ("actorId", "action", "entity", "entityId", "details")
  values (p_actor, 'member.delete', 'ExamMember', t."id", null);
  return jsonb_build_object('paths', v_paths);
end $$;

-- ── access ──
revoke all on function public.exam_may_edit_member(public."ExamMember") from public, anon, authenticated;
revoke all on function public.exam_may_send_link(public."ExamMember") from public, anon, authenticated;
revoke all on function public.exam_member_for_edit(text) from public, anon, authenticated;
revoke all on function public.exam_local_day(text, boolean) from public, anon, authenticated;
revoke all on function public.exam_valid_email(text) from public, anon, authenticated;
revoke all on function public.lms_account_provision(text, text, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.lms_account_relink(text, text, text) from public, anon, authenticated;
revoke all on function public.lms_account_erase(text, text) from public, anon, authenticated;
grant execute on function public.lms_account_provision(text, text, text, text, jsonb) to service_role;
grant execute on function public.lms_account_relink(text, text, text) to service_role;
grant execute on function public.lms_account_erase(text, text) to service_role;

-- the storage policies call this one with the browser's role
revoke all on function public.exam_member_file_can(text, text) from public, anon;
grant execute on function public.exam_member_file_can(text, text) to authenticated;

revoke all on function public.exam_people(jsonb) from public, anon;
revoke all on function public.exam_member_record(text) from public, anon;
revoke all on function public.exam_profile_save(text, jsonb) from public, anon;
revoke all on function public.exam_member_photo(text, text) from public, anon;
revoke all on function public.exam_qualification_save(text, jsonb) from public, anon;
revoke all on function public.exam_qualification_delete(text) from public, anon;
revoke all on function public.exam_enrollment_set(jsonb, text, jsonb) from public, anon;
revoke all on function public.exam_account_check(text, jsonb) from public, anon;
revoke all on function public.exam_people_import_check(jsonb) from public, anon;
grant execute on function public.exam_people(jsonb) to authenticated;
grant execute on function public.exam_member_record(text) to authenticated;
grant execute on function public.exam_profile_save(text, jsonb) to authenticated;
grant execute on function public.exam_member_photo(text, text) to authenticated;
grant execute on function public.exam_qualification_save(text, jsonb) to authenticated;
grant execute on function public.exam_qualification_delete(text) to authenticated;
grant execute on function public.exam_enrollment_set(jsonb, text, jsonb) to authenticated;
grant execute on function public.exam_account_check(text, jsonb) to authenticated;
grant execute on function public.exam_people_import_check(jsonb) to authenticated;
