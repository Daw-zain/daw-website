-- ─────────────────────────────────────────────────────────────────────────────
-- Exam system · Phase 1 — members, course roles, enrollment, course folders.
-- Applied by `npm run supabase:setup` after setup.sql (safe to run again).
--
-- Design (docs/exam-system/02-phase1-report.md):
--   • The public site is static (GitHub Pages), so these PostgreSQL functions ARE the server.
--   • Browser roles (anon / authenticated) cannot touch the exam tables at all (RLS on, no grants).
--   • The browser calls only the exam_* functions granted below; each one reads the caller's
--     Supabase session (JWT "sub"), looks up their role and course permissions, and returns
--     only what that caller is allowed to see.
--   • Functions run as the table owner (SECURITY DEFINER) with a fixed search_path.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Folders: one of each built-in kind per course, created automatically ──
create unique index if not exists "ExamFolder_system_kind_key"
  on public."ExamFolder" ("programId", "kind") where "system";

create or replace function public.exam_create_system_folders(p_program text)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public."ExamFolder" ("programId", "kind", "system", "nameAr", "nameEn", "descAr", "descEn", "sortOrder")
  select p_program, f.kind, true, f.name_ar, f.name_en, f.desc_ar, f.desc_en, f.sort
  from (values
    ('QUESTION_BANK',    'بنك الأسئلة',              'Question Bank',       'أسئلة الدورة وتصنيفاتها وسيناريوهاتها',              'The course questions, categories and scenarios',        1),
    ('DOMAIN_TESTS',     'اختبارات المجالات',         'Domain Tests',        'اختبارات تدريبية حسب المجالات والموضوعات',            'Practice tests by domain and topic',                    2),
    ('EXAM_SIMULATIONS', 'اختبارات محاكية للامتحان',  'Exam Simulations',    'اختبارات تحاكي الامتحان المهني من حيث الوقت والتوزيع', 'Full and partial simulations of the certification exam', 3),
    ('MISTAKES_QUIZ',    'اختبار الأخطاء',            'Mistakes Quiz',       'مراجعة شخصية للأسئلة التي أخطأ فيها المتدرب',        'Personal review of the questions a learner got wrong',  4),
    ('RESULTS',          'النتائج والتقارير',         'Results & Analytics', 'نتائج المحاولات وتحليل الأداء',                       'Attempt results and performance analytics',             5)
  ) as f(kind, name_ar, name_en, desc_ar, desc_en, sort)
  on conflict ("programId", "kind") where "system" do nothing;
$$;

create or replace function public.exam_program_folders_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.exam_create_system_folders(new."id");
  return new;
end $$;

drop trigger if exists "Program_exam_folders" on public."Program";
create trigger "Program_exam_folders" after insert on public."Program"
  for each row execute function public.exam_program_folders_trigger();

-- Existing courses (idempotent)
select public.exam_create_system_folders("id") from public."Program";

-- ── Session helpers (not callable from the browser) ──
create or replace function public.exam_jwt_claim(p_name text)
returns text
language sql
stable
set search_path = public
as $$
  select nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> p_name
$$;

create or replace function public.exam_current_member()
returns public."ExamMember"
language sql
stable
security definer
set search_path = public
as $$
  select m.* from public."ExamMember" m
  where m."authUserId" = public.exam_jwt_claim('sub') and m."active"
$$;

-- ── LMS-1: roles and permissions ──
-- Base roles (ExamMember.role):
--   ADMIN      = super admin: everything, always.
--   STAFF      = admin: only what their AdminRole grants (nothing if the role is missing or switched off).
--   INSTRUCTOR = trainer: only the courses assigned to them, with the per-course permissions.
--   LEARNER    = trainee.
-- A trainer assignment (CourseInstructor) adds course permissions to any member, STAFF included.

-- every section and action a role can grant — the single list the server accepts
create or replace function public.lms_permission_catalogue()
returns jsonb
language sql
immutable
set search_path = public
as $$
  select '{
    "users": ["read", "create", "update", "export"],
    "trainers": ["update"],
    "trainees": ["update"],
    "question_bank": ["read", "update", "import", "delete", "export"],
    "exams": ["manage", "publish"],
    "results": ["read", "update"],
    "audit": ["read", "export"],
    "settings": ["update"],
    "courses": ["read", "create", "update", "content"]
  }'::jsonb
$$;

-- may the caller do this action in this section? (platform-wide permission)
create or replace function public.exam_can(p_section text, p_action text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare me public."ExamMember";
begin
  me := public.exam_current_member();
  if me."id" is null then return false; end if;
  if me."role" = 'ADMIN' then return coalesce((public.lms_permission_catalogue() -> p_section) ? p_action, false); end if;
  if me."role" <> 'STAFF' then return false; end if;
  return exists (select 1 from public."AdminRole" r
                 where r."id" = me."adminRoleId" and r."active" and coalesce((r."permissions" -> p_section) ? p_action, false));
end $$;

create or replace function public.exam_require(p_section text, p_action text)
returns public."ExamMember"
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not coalesce(public.exam_can(p_section, p_action), false) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return public.exam_current_member();
end $$;

-- the platform permission that stands for a per-course permission
create or replace function public.exam_staff_course_perm(p_perm text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(case p_perm
    when 'canEditQuestions' then public.exam_can('question_bank', 'update')
    when 'canManageCategories' then public.exam_can('question_bank', 'update')
    when 'canManageScenarios' then public.exam_can('question_bank', 'update')
    when 'canDeleteQuestions' then public.exam_can('question_bank', 'delete')
    when 'canImport' then public.exam_can('question_bank', 'import')
    when 'canExport' then public.exam_can('question_bank', 'export')
    when 'canCreateExams' then public.exam_can('exams', 'manage')
    when 'canManageDomainTests' then public.exam_can('exams', 'manage')
    when 'canManageSimulations' then public.exam_can('exams', 'manage')
    when 'canPublishExams' then public.exam_can('exams', 'publish')
    when 'canViewResults' then public.exam_can('results', 'read')
    when 'canReviewEssays' then public.exam_can('results', 'update')
    when 'canReopenAttempts' then public.exam_can('results', 'update')
    when 'canManageContent' then public.exam_can('courses', 'content')
  end, false)
$$;

-- LMS-2: does this subscription open the course right now? (timestamps are stored in UTC)
create or replace function public.exam_enrollment_open(e public."Enrollment")
returns boolean
language sql
stable
set search_path = public
as $$
  select coalesce(e."status" = 'ACTIVE'
    and (e."startsAt" is null or e."startsAt" <= (now() at time zone 'utc'))
    and (e."expiresAt" is null or e."expiresAt" > (now() at time zone 'utc')), false)
$$;

-- 'ADMIN' | 'INSTRUCTOR' | 'LEARNER' | null — the caller's relation to one course
create or replace function public.exam_course_access(p_program text)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare me public."ExamMember";
begin
  me := public.exam_current_member();
  if me."id" is null then return null; end if;
  if me."role" = 'ADMIN' then return 'ADMIN'; end if;
  -- a trainer assignment counts for everyone except someone who is now a plain trainee
  if me."role" <> 'LEARNER' and exists (select 1 from public."CourseInstructor" ci where ci."programId" = p_program and ci."memberId" = me."id") then
    return 'INSTRUCTOR';
  end if;
  -- an admin whose role includes the question banks works in every course like its staff
  if public.exam_can('question_bank', 'read') then return 'INSTRUCTOR'; end if;
  if exists (select 1 from public."Enrollment" e where e."programId" = p_program and e."memberId" = me."id" and public.exam_enrollment_open(e)) then
    return 'LEARNER';
  end if;
  return null;
end $$;

-- true for the super admin, a trainer of the course with that permission, or an admin whose role covers it
create or replace function public.exam_instructor_can(p_program text, p_perm text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare me public."ExamMember"; ci public."CourseInstructor";
begin
  me := public.exam_current_member();
  if me."id" is null then return false; end if;
  if me."role" = 'ADMIN' then return true; end if;
  select * into ci from public."CourseInstructor" where "programId" = p_program and "memberId" = me."id" and me."role" <> 'LEARNER';
  return coalesce((to_jsonb(ci) ->> p_perm)::boolean, false) or public.exam_staff_course_perm(p_perm);
end $$;

create or replace function public.exam_log(p_action text, p_entity text, p_entity_id text, p_program text, p_details jsonb)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public."ExamAuditLog" ("actorId", "action", "entity", "entityId", "programId", "details")
  values ((public.exam_current_member())."id", p_action, p_entity, p_entity_id, p_program, p_details);
$$;

create or replace function public.exam_require_admin()
returns public."ExamMember"
language plpgsql
stable
security definer
set search_path = public
as $$
declare me public."ExamMember";
begin
  me := public.exam_current_member();
  if me."id" is null or me."role" <> 'ADMIN' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return me;
end $$;

-- ── Browser-callable functions ──

-- Who am I? Registers the signed-in Supabase user as a LEARNER on first call
-- and returns their role and the courses they can open.
create or replace function public.exam_me()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sub text := public.exam_jwt_claim('sub');
  v_email text := lower(coalesce(public.exam_jwt_claim('email'), ''));
  me public."ExamMember";
  v_courses jsonb;
  v_platform jsonb;
  v_staff boolean;
begin
  if v_sub is null or v_email = '' then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  select * into me from public."ExamMember" where "authUserId" = v_sub;
  if me."id" is null then
    -- LMS-2: a different sign-in never takes over an existing record just by using its e-mail (anyone can
    -- register an address while e-mail confirmation is off). An administrator links it with "password link".
    if exists (select 1 from public."ExamMember" where "email" = v_email) then
      raise exception 'account_conflict' using errcode = '42501';
    end if;
    insert into public."ExamMember" ("authUserId", "email", "name")
    values (v_sub, v_email, coalesce(nullif(current_setting('request.jwt.claims', true)::jsonb #>> '{user_metadata,name}', ''), split_part(v_email, '@', 1)))
    returning * into me;
  elsif me."email" <> v_email and me."deletedAt" is null and not exists (select 1 from public."ExamMember" where "email" = v_email) then
    update public."ExamMember" set "email" = v_email, "updatedAt" = now() where "id" = me."id" returning * into me;
  end if;

  if not me."active" then
    raise exception 'account_disabled' using errcode = '42501';
  end if;

  v_staff := public.exam_can('question_bank', 'read') and me."role" = 'STAFF';
  select coalesce(jsonb_agg(c order by c ->> 'order', c ->> 'code'), '[]'::jsonb) into v_courses
  from (
    select jsonb_build_object(
      'programId', p."id", 'slug', p."slug", 'code', p."code", 'titleAr', p."titleAr", 'titleEn', p."titleEn",
      'order', lpad(p."order"::text, 6, '0'),
      'access', case when me."role" = 'ADMIN' then 'ADMIN' when ci."id" is not null or v_staff then 'INSTRUCTOR' else 'LEARNER' end,
      'viaRole', v_staff and ci."id" is null,
      -- the effective permissions: trainer assignment and admin role together
      'permissions', case when me."role" <> 'ADMIN' and (ci."id" is not null or v_staff) then (
        select jsonb_object_agg(k, public.exam_instructor_can(p."id", k)) from unnest(array[
          'canEditQuestions', 'canDeleteQuestions', 'canManageCategories', 'canManageScenarios', 'canImport', 'canExport', 'canCreateExams',
          'canPublishExams', 'canManageDomainTests', 'canManageSimulations', 'canViewResults', 'canReviewEssays', 'canReopenAttempts', 'canManageContent']) k) end
    ) as c
    from public."Program" p
    left join public."CourseInstructor" ci on ci."programId" = p."id" and ci."memberId" = me."id" and me."role" <> 'LEARNER'
    left join public."Enrollment" e on e."programId" = p."id" and e."memberId" = me."id" and public.exam_enrollment_open(e)
    where me."role" = 'ADMIN' or v_staff or ci."id" is not null or e."id" is not null
  ) s;

  select coalesce(jsonb_object_agg(sec.key, a.actions), '{}'::jsonb) into v_platform
  from jsonb_each(public.lms_permission_catalogue()) sec
  cross join lateral (select jsonb_agg(x) actions from jsonb_array_elements_text(sec.value) x where public.exam_can(sec.key, x)) a
  where a.actions is not null;

  return jsonb_build_object('id', me."id", 'email', me."email", 'name', me."name", 'role', me."role", 'courses', v_courses,
    'platform', v_platform,
    'adminRole', (select jsonb_build_object('nameAr', r."nameAr", 'nameEn', r."nameEn") from public."AdminRole" r where r."id" = me."adminRoleId" and me."role" = 'STAFF'));
end $$;

-- Folders of one course that the caller may open (learners never see the question bank)
create or replace function public.exam_course_folders(p_program text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_access text := public.exam_course_access(p_program);
begin
  if v_access is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', f."id", 'kind', f."kind", 'system', f."system", 'nameAr', f."nameAr", 'nameEn', f."nameEn",
      'descAr', f."descAr", 'descEn', f."descEn", 'status', f."status",
      -- sub-folders are opened from inside their folder
      'folders', (select count(*) from public."ExamFolder" c where c."parentId" = f."id"
                    and (v_access in ('ADMIN', 'INSTRUCTOR') or c."status" = 'ACTIVE')),
      -- staff see how many questions the bank holds (phase 3); learners never see the bank folder
      'count', case when f."kind" = 'QUESTION_BANK' and v_access in ('ADMIN', 'INSTRUCTOR')
                    then (select count(*) from public."Question" q where q."programId" = p_program)
                    -- phase 5: exams in the folder (learners: published only)
                    when f."kind" in ('DOMAIN_TESTS', 'EXAM_SIMULATIONS', 'CUSTOM')
                    then (select count(*) from public."Exam" x
                            join public."ExamFolder" d on d."id" = x."folderId"
                            where (d."id" = f."id" or d."parentId" = f."id")
                            and (v_access in ('ADMIN', 'INSTRUCTOR') or (x."status" = 'PUBLISHED' and d."status" = 'ACTIVE'))) end
      ) order by f."sortOrder", f."createdAt"), '[]'::jsonb)
    from public."ExamFolder" f
    where f."programId" = p_program and f."parentId" is null
      and (v_access in ('ADMIN', 'INSTRUCTOR')
           or (f."status" = 'ACTIVE' and f."kind" in ('DOMAIN_TESTS', 'EXAM_SIMULATIONS', 'MISTAKES_QUIZ', 'RESULTS')))
  );
end $$;

-- Admin: list members (optionally filtered by text)
create or replace function public.exam_admin_members(p_search text default '')
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.exam_require('users', 'read');
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', m."id", 'email', m."email", 'name', m."name", 'role', m."role", 'active', m."active", 'createdAt', m."createdAt",
      'adminRoleId', m."adminRoleId",
      'adminRole', (select jsonb_build_object('nameAr', r."nameAr", 'nameEn', r."nameEn", 'active', r."active") from public."AdminRole" r where r."id" = m."adminRoleId"),
      'instructing', (select coalesce(jsonb_agg(to_jsonb(ci) - 'id' - 'memberId' - 'createdAt' - 'updatedAt'), '[]'::jsonb)
                      from public."CourseInstructor" ci where ci."memberId" = m."id"),
      'enrollments', (select coalesce(jsonb_agg(jsonb_build_object('programId', e."programId", 'status', e."status", 'since', e."createdAt", 'startsAt', e."startsAt", 'expiresAt', e."expiresAt", 'open', public.exam_enrollment_open(e))), '[]'::jsonb)
                      from public."Enrollment" e where e."memberId" = m."id")
    ) order by m."createdAt" desc), '[]'::jsonb)
    from public."ExamMember" m
    where m."deletedAt" is null and (coalesce(p_search, '') = '' or m."email" ilike '%' || p_search || '%' or m."name" ilike '%' || p_search || '%')
  );
end $$;

-- Admin: change a member's site role
create or replace function public.exam_admin_set_role(p_email text, p_role text, p_admin_role text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare me public."ExamMember" := public.exam_require('users', 'update'); target public."ExamMember"; v_role public."AdminRole";
begin
  if p_role is null or p_role not in ('ADMIN', 'STAFF', 'INSTRUCTOR', 'LEARNER') then
    raise exception 'invalid_role' using errcode = '22023';
  end if;
  select * into target from public."ExamMember" where "email" = lower(trim(p_email)) and "deletedAt" is null;
  if target."id" is null then
    raise exception 'member_not_found' using errcode = 'P0002';
  end if;
  -- only the super admin manages administrators; nobody else changes their own role
  if me."role" <> 'ADMIN' and (target."role" in ('ADMIN', 'STAFF') or p_role in ('ADMIN', 'STAFF') or target."id" = me."id") then
    raise exception 'super_admin_only' using errcode = '42501';
  end if;
  if p_role = 'STAFF' then
    select * into v_role from public."AdminRole" where "id" = p_admin_role and "active";
    if v_role."id" is null then raise exception 'invalid_admin_role' using errcode = '22023'; end if;
  end if;
  if target."role" = 'ADMIN' and p_role <> 'ADMIN'
     and (select count(*) from public."ExamMember" where "role" = 'ADMIN' and "active") <= 1 then
    raise exception 'last_admin' using errcode = '42501';
  end if;
  update public."ExamMember" set "role" = p_role, "adminRoleId" = v_role."id", "updatedAt" = now() where "id" = target."id";
  perform public.exam_log('member.role', 'ExamMember', target."id", null,
    jsonb_strip_nulls(jsonb_build_object('email', target."email", 'from', target."role", 'to', p_role, 'adminRole', v_role."nameAr")));
  return jsonb_build_object('email', target."email", 'role', p_role, 'adminRoleId', v_role."id");
end $$;

-- Admin: enable / disable a member (a disabled member is refused by every exam_* function)
create or replace function public.exam_admin_set_active(p_email text, p_active boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare me public."ExamMember" := public.exam_require('users', 'update'); target public."ExamMember";
begin
  if p_active is null then raise exception 'invalid_status' using errcode = '22023'; end if;
  select * into target from public."ExamMember" where "email" = lower(trim(p_email)) and "deletedAt" is null;
  if target."id" is null then
    raise exception 'member_not_found' using errcode = 'P0002';
  end if;
  if me."role" <> 'ADMIN' and target."role" in ('ADMIN', 'STAFF') then
    raise exception 'super_admin_only' using errcode = '42501';
  end if;
  if not p_active and target."id" = me."id" then
    raise exception 'cannot_disable_self' using errcode = '42501';
  end if;
  update public."ExamMember" set "active" = p_active, "updatedAt" = now() where "id" = target."id";
  perform public.exam_log(case when p_active then 'member.enable' else 'member.disable' end, 'ExamMember', target."id", null, jsonb_build_object('email', target."email"));
  return jsonb_build_object('email', target."email", 'active', p_active);
end $$;

-- Admin: assign (or update) an instructor on a course with permissions
create or replace function public.exam_admin_assign_instructor(p_program text, p_email text, p_perms jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare me public."ExamMember" := public.exam_require('trainers', 'update'); target public."ExamMember"; ci public."CourseInstructor"; v_before jsonb; k text;
begin
  if not exists (select 1 from public."Program" where "id" = p_program) then
    raise exception 'course_not_found' using errcode = 'P0002';
  end if;
  select * into target from public."ExamMember" where "email" = lower(trim(p_email)) and "deletedAt" is null;
  if target."id" is null then
    raise exception 'member_not_found' using errcode = 'P0002';
  end if;
  if me."role" <> 'ADMIN' and (target."role" in ('ADMIN', 'STAFF') or target."id" = me."id") then
    raise exception 'super_admin_only' using errcode = '42501';
  end if;
  select to_jsonb(c) into v_before from public."CourseInstructor" c where c."programId" = p_program and c."memberId" = target."id";
  if target."role" = 'LEARNER' then
    update public."ExamMember" set "role" = 'INSTRUCTOR', "updatedAt" = now() where "id" = target."id";
  end if;

  insert into public."CourseInstructor" ("programId", "memberId") values (p_program, target."id")
  on conflict ("programId", "memberId") do update set "updatedAt" = now()
  returning * into ci;

  -- only known boolean permission columns are applied
  update public."CourseInstructor" c set
    "canEditQuestions"     = coalesce((p_perms ->> 'canEditQuestions')::boolean,     c."canEditQuestions"),
    "canDeleteQuestions"   = coalesce((p_perms ->> 'canDeleteQuestions')::boolean,   c."canDeleteQuestions"),
    "canManageCategories"  = coalesce((p_perms ->> 'canManageCategories')::boolean,  c."canManageCategories"),
    "canManageScenarios"   = coalesce((p_perms ->> 'canManageScenarios')::boolean,   c."canManageScenarios"),
    "canImport"            = coalesce((p_perms ->> 'canImport')::boolean,            c."canImport"),
    "canExport"            = coalesce((p_perms ->> 'canExport')::boolean,            c."canExport"),
    "canCreateExams"       = coalesce((p_perms ->> 'canCreateExams')::boolean,       c."canCreateExams"),
    "canPublishExams"      = coalesce((p_perms ->> 'canPublishExams')::boolean,      c."canPublishExams"),
    "canManageDomainTests" = coalesce((p_perms ->> 'canManageDomainTests')::boolean, c."canManageDomainTests"),
    "canManageSimulations" = coalesce((p_perms ->> 'canManageSimulations')::boolean, c."canManageSimulations"),
    "canViewResults"       = coalesce((p_perms ->> 'canViewResults')::boolean,       c."canViewResults"),
    "canReviewEssays"      = coalesce((p_perms ->> 'canReviewEssays')::boolean,      c."canReviewEssays"),
    "canReopenAttempts"    = coalesce((p_perms ->> 'canReopenAttempts')::boolean,    c."canReopenAttempts"),
    "canManageContent"     = coalesce((p_perms ->> 'canManageContent')::boolean,     c."canManageContent"),
    "updatedAt" = now()
  where c."id" = ci."id"
  returning * into ci;

  -- nobody can give more than they have: a permission switched on here must be one the caller holds
  if me."role" <> 'ADMIN' then
    for k in select key from jsonb_each(to_jsonb(ci)) where key like 'can%' and value = 'true'::jsonb loop
      if not coalesce((v_before ->> k)::boolean, false) and not public.exam_instructor_can(p_program, k) then
        raise exception 'cannot_grant' using errcode = '42501';
      end if;
    end loop;
  end if;

  perform public.exam_log('instructor.assign', 'CourseInstructor', ci."id", p_program, coalesce(p_perms, '{}'::jsonb) || jsonb_build_object('email', target."email"));
  return to_jsonb(ci);
end $$;

create or replace function public.exam_admin_remove_instructor(p_program text, p_email text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare me public."ExamMember" := public.exam_require('trainers', 'update'); v_id text;
begin
  if me."role" <> 'ADMIN' and exists (select 1 from public."ExamMember" t where t."email" = lower(trim(p_email)) and (t."role" in ('ADMIN', 'STAFF') or t."id" = me."id")) then
    raise exception 'super_admin_only' using errcode = '42501';
  end if;
  delete from public."CourseInstructor" ci using public."ExamMember" m
  where ci."memberId" = m."id" and m."email" = lower(trim(p_email)) and ci."programId" = p_program
  returning ci."id" into v_id;
  if v_id is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  perform public.exam_log('instructor.remove', 'CourseInstructor', v_id, p_program, jsonb_build_object('email', lower(trim(p_email))));
end $$;

-- Admin: enroll a learner in a course, or change the enrollment status
create or replace function public.exam_admin_enroll(p_program text, p_email text, p_status text default 'ACTIVE', p_registration text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare me public."ExamMember" := public.exam_require('trainees', 'update'); target public."ExamMember"; en public."Enrollment";
begin
  if p_status is null or p_status not in ('ACTIVE', 'SUSPENDED', 'COMPLETED', 'CANCELLED') then
    raise exception 'invalid_status' using errcode = '22023';
  end if;
  if not exists (select 1 from public."Program" where "id" = p_program) then
    raise exception 'course_not_found' using errcode = 'P0002';
  end if;
  select * into target from public."ExamMember" where "email" = lower(trim(p_email)) and "deletedAt" is null;
  if target."id" is null then
    raise exception 'member_not_found' using errcode = 'P0002';
  end if;
  insert into public."Enrollment" ("programId", "memberId", "status", "registrationId", "createdById")
  values (p_program, target."id", p_status, p_registration, me."id")
  on conflict ("programId", "memberId") do update
    set "status" = excluded."status", "registrationId" = coalesce(excluded."registrationId", "Enrollment"."registrationId"), "updatedAt" = now()
  returning * into en;
  perform public.exam_log('enrollment.set', 'Enrollment', en."id", p_program, jsonb_build_object('email', target."email", 'status', p_status));
  return to_jsonb(en);
end $$;

-- Admin or instructor (with canViewResults): people of one course
create or replace function public.exam_course_people(p_program text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.exam_instructor_can(p_program, 'canViewResults') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'instructors', (select coalesce(jsonb_agg(jsonb_build_object('email', m."email", 'name', m."name") order by m."name"), '[]'::jsonb)
                    from public."CourseInstructor" ci join public."ExamMember" m on m."id" = ci."memberId" where ci."programId" = p_program and m."role" <> 'LEARNER'),
    'learners', (select coalesce(jsonb_agg(jsonb_build_object('email', m."email", 'name', m."name", 'status', e."status", 'since', e."createdAt", 'expiresAt', e."expiresAt", 'open', public.exam_enrollment_open(e)) order by m."name"), '[]'::jsonb)
                 from public."Enrollment" e join public."ExamMember" m on m."id" = e."memberId" where e."programId" = p_program)
  );
end $$;

-- ── Access: lock the tables, expose only the functions above ──
do $$
declare t text;
begin
  foreach t in array array['ExamMember', 'CourseInstructor', 'Enrollment', 'ExamFolder', 'ExamAuditLog', 'AdminRole', 'MemberProfile', 'MemberQualification'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;

revoke all on function public.exam_create_system_folders(text) from public, anon, authenticated;
revoke all on function public.exam_program_folders_trigger() from public, anon, authenticated;
revoke all on function public.exam_jwt_claim(text) from public, anon, authenticated;
revoke all on function public.exam_current_member() from public, anon, authenticated;
revoke all on function public.exam_course_access(text) from public, anon, authenticated;
revoke all on function public.exam_instructor_can(text, text) from public, anon, authenticated;
revoke all on function public.exam_log(text, text, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.exam_require_admin() from public, anon, authenticated;
revoke all on function public.lms_permission_catalogue() from public, anon, authenticated;
revoke all on function public.exam_can(text, text) from public, anon, authenticated;
revoke all on function public.exam_require(text, text) from public, anon, authenticated;
revoke all on function public.exam_staff_course_perm(text) from public, anon, authenticated;
revoke all on function public.exam_enrollment_open(public."Enrollment") from public, anon, authenticated;

revoke all on function public.exam_me() from public, anon;
revoke all on function public.exam_course_folders(text) from public, anon;
revoke all on function public.exam_admin_members(text) from public, anon;
drop function if exists public.exam_admin_set_role(text, text);
revoke all on function public.exam_admin_set_role(text, text, text) from public, anon;
revoke all on function public.exam_admin_set_active(text, boolean) from public, anon;
revoke all on function public.exam_admin_assign_instructor(text, text, jsonb) from public, anon;
revoke all on function public.exam_admin_remove_instructor(text, text) from public, anon;
revoke all on function public.exam_admin_enroll(text, text, text, text) from public, anon;
revoke all on function public.exam_course_people(text) from public, anon;

grant execute on function public.exam_me() to authenticated;
grant execute on function public.exam_course_folders(text) to authenticated;
grant execute on function public.exam_admin_members(text) to authenticated;
grant execute on function public.exam_admin_set_role(text, text, text) to authenticated;
grant execute on function public.exam_admin_set_active(text, boolean) to authenticated;
grant execute on function public.exam_admin_assign_instructor(text, text, jsonb) to authenticated;
grant execute on function public.exam_admin_remove_instructor(text, text) to authenticated;
grant execute on function public.exam_admin_enroll(text, text, text, text) to authenticated;
grant execute on function public.exam_course_people(text) to authenticated;
