-- ─────────────────────────────────────────────────────────────────────────────
-- LMS · Phase 1 — administrative roles and the activity log.
-- Applied by `npm run supabase:setup` after the exam files (safe to run again).
--
-- The permission checks themselves live in supabase/exams.sql (exam_can / exam_require /
-- exam_instructor_can), so every existing function obeys the same roles.
--   • Roles are created, changed and deleted by the super admin only.
--   • The activity log joins the platform log and the website dashboard's log; nothing in the
--     browser can edit or delete it.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public."AdminRole" enable row level security;
revoke all on public."AdminRole" from anon, authenticated;

-- a starting "Admin" role; later edits by the super admin are never overwritten
insert into public."AdminRole" ("key", "nameAr", "nameEn", "descAr", "descEn", "system", "permissions") values (
  'admin', 'مدير', 'Admin',
  'إدارة المستخدمين والمدربين والمتدربين والاختبارات ومتابعة النتائج، دون حذف الأسئلة أو تصديرها.',
  'Manages users, trainers, trainees and tests and follows results, without deleting or exporting questions.',
  true,
  '{"users": ["read", "update"], "trainers": ["update"], "trainees": ["update"], "question_bank": ["read", "update", "import"], "exams": ["manage", "publish"], "results": ["read", "update"], "audit": ["read"]}'::jsonb
) on conflict ("key") do nothing;

-- keep only known permissions and add the ones they depend on; unknown input is refused
create or replace function public.lms_normalize_permissions(p jsonb)
returns jsonb
language plpgsql
immutable
set search_path = public
as $$
declare
  cat jsonb := public.lms_permission_catalogue();
  want text[] := '{}'; sec text; acts jsonb; a text;
begin
  if p is null or jsonb_typeof(p) <> 'object' then raise exception 'invalid_permissions'; end if;
  for sec, acts in select key, value from jsonb_each(p) loop
    if not cat ? sec or jsonb_typeof(acts) <> 'array' then raise exception 'invalid_permissions'; end if;
    for a in select jsonb_array_elements_text(acts) loop
      if not (cat -> sec) ? a then raise exception 'invalid_permissions'; end if;
      want := want || (sec || '.' || a);
    end loop;
  end loop;
  -- managing people needs the member list
  if want && array['users.update', 'trainers.update', 'trainees.update'] then want := want || 'users.read'::text; end if;
  if 'results.update' = any(want) then want := want || 'results.read'::text; end if;
  if 'audit.export' = any(want) then want := want || 'audit.read'::text; end if;
  -- tests and results show the questions, so they include viewing the question banks
  if exists (select 1 from unnest(want) w where w like 'question\_bank.%' or w like 'exams.%' or w like 'results.%') then
    want := want || 'question_bank.read'::text;
  end if;
  return coalesce((
    select jsonb_object_agg(s.key, x.actions)
    from jsonb_each(cat) s
    cross join lateral (select jsonb_agg(v order by n) actions from jsonb_array_elements_text(s.value) with ordinality t(v, n) where (s.key || '.' || v) = any(want)) x
    where x.actions is not null), '{}'::jsonb);
end $$;

-- every course, with the course permissions the caller holds (what they may pass on to a trainer)
create or replace function public.exam_admin_courses()
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
      'programId', p."id", 'code', p."code", 'titleAr', p."titleAr", 'titleEn', p."titleEn",
      'mine', (select jsonb_object_agg(k, public.exam_instructor_can(p."id", k)) from unnest(array[
        'canEditQuestions', 'canDeleteQuestions', 'canManageCategories', 'canManageScenarios', 'canImport', 'canExport', 'canCreateExams',
        'canPublishExams', 'canManageDomainTests', 'canManageSimulations', 'canViewResults', 'canReviewEssays', 'canReopenAttempts']) k)
    ) order by p."order", p."code"), '[]'::jsonb)
    from public."Program" p);
end $$;

-- ── roles ──

create or replace function public.exam_roles()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.exam_require('users', 'read');
  return jsonb_build_object(
    'catalogue', public.lms_permission_catalogue(),
    'roles', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', r."id", 'key', r."key", 'nameAr', r."nameAr", 'nameEn', r."nameEn", 'descAr', r."descAr", 'descEn', r."descEn",
        'system', r."system", 'active', r."active", 'permissions', r."permissions",
        'members', (select count(*) from public."ExamMember" m where m."adminRoleId" = r."id")) order by r."system" desc, r."createdAt", r."nameAr"), '[]'::jsonb)
      from public."AdminRole" r));
end $$;

create or replace function public.exam_role_save(p_role jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me public."ExamMember" := public.exam_require_admin();
  v_id text := nullif(p_role ->> 'id', '');
  v_ar text := trim(coalesce(p_role ->> 'nameAr', ''));
  v_en text := trim(coalesce(p_role ->> 'nameEn', ''));
  v_active boolean := coalesce((p_role ->> 'active')::boolean, true);
  v_perms jsonb := public.lms_normalize_permissions(p_role -> 'permissions');
  cur public."AdminRole"; res public."AdminRole";
begin
  if v_ar = '' then raise exception 'invalid_role: name_missing'; end if;
  if char_length(v_ar) > 80 or char_length(v_en) > 80 or char_length(coalesce(p_role ->> 'descAr', '')) > 500 or char_length(coalesce(p_role ->> 'descEn', '')) > 500 then
    raise exception 'invalid_role: too_long';
  end if;
  if exists (select 1 from public."AdminRole" r where lower(r."nameAr") = lower(v_ar) and r."id" is distinct from v_id) then
    raise exception 'invalid_role: name_used';
  end if;
  if v_id is null then
    insert into public."AdminRole" ("key", "nameAr", "nameEn", "descAr", "descEn", "active", "permissions", "createdById")
    values ('role_' || replace(gen_random_uuid()::text, '-', ''), v_ar, v_en, trim(coalesce(p_role ->> 'descAr', '')), trim(coalesce(p_role ->> 'descEn', '')), v_active, v_perms, me."id")
    returning * into res;
  else
    select * into cur from public."AdminRole" where "id" = v_id for update;
    if cur."id" is null then raise exception 'not_found' using errcode = 'P0002'; end if;
    update public."AdminRole" set "nameAr" = v_ar, "nameEn" = v_en, "descAr" = trim(coalesce(p_role ->> 'descAr', '')), "descEn" = trim(coalesce(p_role ->> 'descEn', '')),
      "active" = v_active, "permissions" = v_perms, "updatedAt" = now()
    where "id" = v_id returning * into res;
  end if;
  perform public.exam_log(case when v_id is null then 'role.create' else 'role.update' end, 'AdminRole', res."id", null,
    jsonb_strip_nulls(jsonb_build_object('name', res."nameAr", 'active', res."active", 'before', cur."permissions", 'after', res."permissions")));
  return to_jsonb(res);
end $$;

create or replace function public.exam_role_delete(p_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare me public."ExamMember" := public.exam_require_admin(); r public."AdminRole";
begin
  select * into r from public."AdminRole" where "id" = p_id for update;
  if r."id" is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  if r."system" then raise exception 'role_system' using errcode = '42501'; end if;
  if exists (select 1 from public."ExamMember" where "adminRoleId" = p_id) then raise exception 'role_in_use' using errcode = '23503'; end if;
  delete from public."AdminRole" where "id" = p_id;
  perform public.exam_log('role.delete', 'AdminRole', p_id, null, jsonb_build_object('name', r."nameAr", 'before', r."permissions"));
end $$;

-- ── activity log ──
-- filter: {q (person), area (action prefix), source (platform | website), from, to, page, export}
create or replace function public.exam_audit(p_filter jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  f jsonb := coalesce(p_filter, '{}'::jsonb);
  v_export boolean := coalesce((f ->> 'export')::boolean, false);
  v_page int := greatest(coalesce((f ->> 'page')::int, 1), 1);
  v_size int := 50;
  v_q text := nullif(trim(f ->> 'q'), '');
  v_area text := nullif(f ->> 'area', '');
  result jsonb;
begin
  perform public.exam_require('audit', case when v_export then 'export' else 'read' end);
  perform public.exam_rate_hit('audit', 60);
  if v_export then v_page := 1; v_size := 5000; end if;

  with everything as (
    select 'platform'::text source, l."createdAt" at, l."action", l."entity", l."entityId", l."programId", l."details", m."name" actor_name, m."email" actor_email
    from public."ExamAuditLog" l left join public."ExamMember" m on m."id" = l."actorId"
    union all
    select 'website', w."createdAt", w."action", w."entity", w."entityId", null,
      case when w."details" is not null then jsonb_build_object('text', w."details") end, u."name", u."email"
    from public."AuditLog" w left join public."User" u on u."id" = w."userId"
  ),
  m as (
    select * from everything e
    where (nullif(f ->> 'source', '') is null or e.source = f ->> 'source')
      and (v_area is null or e."action" = v_area or starts_with(e."action", v_area || '.'))
      and (v_q is null or e.actor_name ilike '%' || v_q || '%' or e.actor_email ilike '%' || v_q || '%')
      and (nullif(f ->> 'from', '') is null or e.at >= (f ->> 'from')::date)
      and (nullif(f ->> 'to', '') is null or e.at < (f ->> 'to')::date + 1)
  )
  select jsonb_build_object(
    'total', (select count(*) from m),
    'page', v_page, 'pageSize', v_size,
    'areas', (select coalesce(jsonb_agg(distinct split_part(e."action", '.', 1)), '[]'::jsonb) from everything e),
    'items', (select coalesce(jsonb_agg(jsonb_build_object(
        'source', x.source, 'at', x.at, 'action', x."action", 'entity', x."entity", 'entityId', x."entityId", 'details', x."details",
        'actorName', x.actor_name, 'actorEmail', x.actor_email,
        'course', (select coalesce(p."code", p."titleAr") from public."Program" p where p."id" = x."programId")) order by x.at desc, x."action"), '[]'::jsonb)
      from (select * from m order by at desc, "action" offset (v_page - 1) * v_size limit v_size) x))
  into result;

  if v_export then
    perform public.exam_log('audit.export', 'ExamAuditLog', null, null, f - 'export');
  end if;
  return result;
end $$;

-- ── access ──
revoke all on function public.lms_normalize_permissions(jsonb) from public, anon, authenticated;
revoke all on function public.exam_admin_courses() from public, anon;
grant execute on function public.exam_admin_courses() to authenticated;
revoke all on function public.exam_roles() from public, anon;
revoke all on function public.exam_role_save(jsonb) from public, anon;
revoke all on function public.exam_role_delete(text) from public, anon;
revoke all on function public.exam_audit(jsonb) from public, anon;
grant execute on function public.exam_roles() to authenticated;
grant execute on function public.exam_role_save(jsonb) to authenticated;
grant execute on function public.exam_role_delete(text) to authenticated;
grant execute on function public.exam_audit(jsonb) to authenticated;
