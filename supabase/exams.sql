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
  if exists (select 1 from public."CourseInstructor" ci where ci."programId" = p_program and ci."memberId" = me."id") then
    return 'INSTRUCTOR';
  end if;
  if exists (select 1 from public."Enrollment" e where e."programId" = p_program and e."memberId" = me."id" and e."status" = 'ACTIVE') then
    return 'LEARNER';
  end if;
  return null;
end $$;

-- true when the caller is an admin, or an instructor of the course with that permission column set
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
  select * into ci from public."CourseInstructor" where "programId" = p_program and "memberId" = me."id";
  if ci."id" is null then return false; end if;
  return coalesce((to_jsonb(ci) ->> p_perm)::boolean, false);
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
begin
  if v_sub is null or v_email = '' then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  select * into me from public."ExamMember" where "authUserId" = v_sub;
  if me."id" is null then
    -- same verified e-mail re-created in Supabase Auth → re-link instead of duplicating
    update public."ExamMember" set "authUserId" = v_sub, "updatedAt" = now()
      where "email" = v_email returning * into me;
    if me."id" is null then
      insert into public."ExamMember" ("authUserId", "email", "name")
      values (v_sub, v_email, coalesce(nullif(current_setting('request.jwt.claims', true)::jsonb #>> '{user_metadata,name}', ''), split_part(v_email, '@', 1)))
      returning * into me;
    end if;
  elsif me."email" <> v_email then
    update public."ExamMember" set "email" = v_email, "updatedAt" = now() where "id" = me."id" returning * into me;
  end if;

  if not me."active" then
    raise exception 'account_disabled' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(c order by c ->> 'order', c ->> 'code'), '[]'::jsonb) into v_courses
  from (
    select jsonb_build_object(
      'programId', p."id", 'slug', p."slug", 'code', p."code", 'titleAr', p."titleAr", 'titleEn', p."titleEn",
      'order', lpad(p."order"::text, 6, '0'),
      'access', case when me."role" = 'ADMIN' then 'ADMIN' when ci."id" is not null then 'INSTRUCTOR' else 'LEARNER' end,
      'permissions', case when ci."id" is not null then to_jsonb(ci) - 'id' - 'programId' - 'memberId' - 'createdAt' - 'updatedAt' end
    ) as c
    from public."Program" p
    left join public."CourseInstructor" ci on ci."programId" = p."id" and ci."memberId" = me."id"
    left join public."Enrollment" e on e."programId" = p."id" and e."memberId" = me."id" and e."status" = 'ACTIVE'
    where me."role" = 'ADMIN' or ci."id" is not null or e."id" is not null
  ) s;

  return jsonb_build_object('id', me."id", 'email', me."email", 'name', me."name", 'role', me."role", 'courses', v_courses);
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
      -- staff see how many questions the bank holds (phase 3); learners never see the bank folder
      'count', case when f."kind" = 'QUESTION_BANK' and v_access in ('ADMIN', 'INSTRUCTOR')
                    then (select count(*) from public."Question" q where q."programId" = p_program)
                    -- phase 5: exams in the folder (learners: published only)
                    when f."kind" in ('DOMAIN_TESTS', 'EXAM_SIMULATIONS', 'CUSTOM')
                    then (select count(*) from public."Exam" x where x."folderId" = f."id"
                            and (v_access in ('ADMIN', 'INSTRUCTOR') or x."status" = 'PUBLISHED')) end
      ) order by f."sortOrder", f."createdAt"), '[]'::jsonb)
    from public."ExamFolder" f
    where f."programId" = p_program
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
  perform public.exam_require_admin();
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', m."id", 'email', m."email", 'name', m."name", 'role', m."role", 'active', m."active", 'createdAt', m."createdAt",
      'instructing', (select coalesce(jsonb_agg(to_jsonb(ci) - 'id' - 'memberId' - 'createdAt' - 'updatedAt'), '[]'::jsonb)
                      from public."CourseInstructor" ci where ci."memberId" = m."id"),
      'enrollments', (select coalesce(jsonb_agg(jsonb_build_object('programId', e."programId", 'status', e."status", 'since', e."createdAt")), '[]'::jsonb)
                      from public."Enrollment" e where e."memberId" = m."id")
    ) order by m."createdAt" desc), '[]'::jsonb)
    from public."ExamMember" m
    where coalesce(p_search, '') = '' or m."email" ilike '%' || p_search || '%' or m."name" ilike '%' || p_search || '%'
  );
end $$;

-- Admin: change a member's site role
create or replace function public.exam_admin_set_role(p_email text, p_role text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare me public."ExamMember" := public.exam_require_admin(); target public."ExamMember";
begin
  if p_role not in ('ADMIN', 'INSTRUCTOR', 'LEARNER') then
    raise exception 'invalid_role' using errcode = '22023';
  end if;
  select * into target from public."ExamMember" where "email" = lower(trim(p_email));
  if target."id" is null then
    raise exception 'member_not_found' using errcode = 'P0002';
  end if;
  if target."role" = 'ADMIN' and p_role <> 'ADMIN'
     and (select count(*) from public."ExamMember" where "role" = 'ADMIN' and "active") <= 1 then
    raise exception 'last_admin' using errcode = '42501';
  end if;
  update public."ExamMember" set "role" = p_role, "updatedAt" = now() where "id" = target."id";
  perform public.exam_log('member.role', 'ExamMember', target."id", null, jsonb_build_object('from', target."role", 'to', p_role));
  return jsonb_build_object('email', target."email", 'role', p_role);
end $$;

-- Admin: enable / disable a member (a disabled member is refused by every exam_* function)
create or replace function public.exam_admin_set_active(p_email text, p_active boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare me public."ExamMember" := public.exam_require_admin(); target public."ExamMember";
begin
  select * into target from public."ExamMember" where "email" = lower(trim(p_email));
  if target."id" is null then
    raise exception 'member_not_found' using errcode = 'P0002';
  end if;
  if not p_active and target."id" = me."id" then
    raise exception 'cannot_disable_self' using errcode = '42501';
  end if;
  update public."ExamMember" set "active" = p_active, "updatedAt" = now() where "id" = target."id";
  perform public.exam_log(case when p_active then 'member.enable' else 'member.disable' end, 'ExamMember', target."id", null, null);
  return jsonb_build_object('email', target."email", 'active', p_active);
end $$;

-- Admin: assign (or update) an instructor on a course with permissions
create or replace function public.exam_admin_assign_instructor(p_program text, p_email text, p_perms jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare me public."ExamMember" := public.exam_require_admin(); target public."ExamMember"; ci public."CourseInstructor";
begin
  if not exists (select 1 from public."Program" where "id" = p_program) then
    raise exception 'course_not_found' using errcode = 'P0002';
  end if;
  select * into target from public."ExamMember" where "email" = lower(trim(p_email));
  if target."id" is null then
    raise exception 'member_not_found' using errcode = 'P0002';
  end if;
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
    "updatedAt" = now()
  where c."id" = ci."id"
  returning * into ci;

  perform public.exam_log('instructor.assign', 'CourseInstructor', ci."id", p_program, p_perms);
  return to_jsonb(ci);
end $$;

create or replace function public.exam_admin_remove_instructor(p_program text, p_email text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare me public."ExamMember" := public.exam_require_admin(); v_id text;
begin
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
declare me public."ExamMember" := public.exam_require_admin(); target public."ExamMember"; en public."Enrollment";
begin
  if p_status not in ('ACTIVE', 'SUSPENDED', 'COMPLETED') then
    raise exception 'invalid_status' using errcode = '22023';
  end if;
  if not exists (select 1 from public."Program" where "id" = p_program) then
    raise exception 'course_not_found' using errcode = 'P0002';
  end if;
  select * into target from public."ExamMember" where "email" = lower(trim(p_email));
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
                    from public."CourseInstructor" ci join public."ExamMember" m on m."id" = ci."memberId" where ci."programId" = p_program),
    'learners', (select coalesce(jsonb_agg(jsonb_build_object('email', m."email", 'name', m."name", 'status', e."status", 'since', e."createdAt") order by m."name"), '[]'::jsonb)
                 from public."Enrollment" e join public."ExamMember" m on m."id" = e."memberId" where e."programId" = p_program)
  );
end $$;

-- ── Access: lock the tables, expose only the functions above ──
do $$
declare t text;
begin
  foreach t in array array['ExamMember', 'CourseInstructor', 'Enrollment', 'ExamFolder', 'ExamAuditLog'] loop
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

revoke all on function public.exam_me() from public, anon;
revoke all on function public.exam_course_folders(text) from public, anon;
revoke all on function public.exam_admin_members(text) from public, anon;
revoke all on function public.exam_admin_set_role(text, text) from public, anon;
revoke all on function public.exam_admin_set_active(text, boolean) from public, anon;
revoke all on function public.exam_admin_assign_instructor(text, text, jsonb) from public, anon;
revoke all on function public.exam_admin_remove_instructor(text, text) from public, anon;
revoke all on function public.exam_admin_enroll(text, text, text, text) from public, anon;
revoke all on function public.exam_course_people(text) from public, anon;

grant execute on function public.exam_me() to authenticated;
grant execute on function public.exam_course_folders(text) to authenticated;
grant execute on function public.exam_admin_members(text) to authenticated;
grant execute on function public.exam_admin_set_role(text, text) to authenticated;
grant execute on function public.exam_admin_set_active(text, boolean) to authenticated;
grant execute on function public.exam_admin_assign_instructor(text, text, jsonb) to authenticated;
grant execute on function public.exam_admin_remove_instructor(text, text) to authenticated;
grant execute on function public.exam_admin_enroll(text, text, text, text) to authenticated;
grant execute on function public.exam_course_people(text) to authenticated;
