-- ─────────────────────────────────────────────────────────────────────────────
-- Exam system · Phase 4 — multi-question scenarios + private attachments.
-- Applied by `npm run supabase:setup` after exams-bank.sql (safe to run again).
-- The Storage bucket and its policies live in supabase/exams-storage.sql (needs the project owner role).
--
--   • A scenario is its own record (title, case text, structured details, tables); questions point to it
--     with "scenarioId" + "scenarioOrder", so the case text is stored once, never copied into questions.
--   • Attachments (images / PDF) are files in the PRIVATE bucket "exam-assets", path
--     <programId>/<ownerId>/<uuid>.<ext>. The table "ExamAsset" records them; reading needs a signed URL,
--     which the storage policies only allow to staff of that course.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── helpers ──

create or replace function public.exam_scenario_json(p_id text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id', s."id", 'programId', s."programId", 'titleAr', s."titleAr", 'titleEn', s."titleEn",
    'bodyAr', s."bodyAr", 'bodyEn', s."bodyEn", 'details', s."details", 'tables', s."tables",
    'displayMode', s."displayMode", 'status', s."status", 'version', s."version",
    'createdAt', s."createdAt", 'updatedAt', s."updatedAt")
  from public."Scenario" s where s."id" = p_id
$$;

-- validate the structured case details: only known parts, each {ar, en} text
create or replace function public.exam_scenario_details(p jsonb)
returns jsonb
language plpgsql
immutable
set search_path = public
as $$
declare k text; v_out jsonb := '{}'::jsonb; v_ar text; v_en text;
begin
  if p is null or jsonb_typeof(p) <> 'object' then return '{}'::jsonb; end if;
  foreach k in array array['project', 'events', 'constraints', 'risks', 'stakeholders', 'info'] loop
    v_ar := left(coalesce(trim(p -> k ->> 'ar'), ''), 8000);
    v_en := left(coalesce(trim(p -> k ->> 'en'), ''), 8000);
    if v_ar <> '' or v_en <> '' then
      v_out := v_out || jsonb_build_object(k, jsonb_build_object('ar', v_ar, 'en', v_en));
    end if;
  end loop;
  return v_out;
end $$;

-- validate tables: up to 10 tables, 40 rows × 12 columns, cells up to 500 chars
create or replace function public.exam_scenario_tables(p jsonb)
returns jsonb
language plpgsql
immutable
set search_path = public
as $$
declare t jsonb; r jsonb; v_out jsonb := '[]'::jsonb; v_rows jsonb; v_row jsonb; n int := 0; cols int;
begin
  if p is null or jsonb_typeof(p) <> 'array' then return '[]'::jsonb; end if;
  for t in select value from jsonb_array_elements(p) loop
    n := n + 1;
    if n > 10 then raise exception 'invalid_scenario: tables_max_10'; end if;
    if coalesce(jsonb_typeof(t -> 'rows'), '') <> 'array' or jsonb_array_length(t -> 'rows') = 0 then
      raise exception 'invalid_scenario: table_empty';
    end if;
    if jsonb_array_length(t -> 'rows') > 40 then raise exception 'invalid_scenario: table_rows_max_40'; end if;
    v_rows := '[]'::jsonb;
    cols := null;
    for r in select value from jsonb_array_elements(t -> 'rows') loop
      if coalesce(jsonb_typeof(r), '') <> 'array' then raise exception 'invalid_scenario: table_row'; end if;
      if cols is null then cols := jsonb_array_length(r); end if;
      if jsonb_array_length(r) <> cols or cols = 0 or cols > 12 then raise exception 'invalid_scenario: table_columns'; end if;
      select jsonb_agg(left(coalesce(c, ''), 500)) into v_row from jsonb_array_elements_text(r) c;
      v_rows := v_rows || jsonb_build_array(v_row);
    end loop;
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'captionAr', left(coalesce(trim(t ->> 'captionAr'), ''), 300),
      'captionEn', left(coalesce(trim(t ->> 'captionEn'), ''), 300),
      'rows', v_rows));
  end loop;
  return v_out;
end $$;

-- course a question / scenario belongs to (null if it does not exist)
create or replace function public.exam_asset_owner_program(p_owner_type text, p_owner_id text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case p_owner_type
    when 'QUESTION' then (select "programId" from public."Question" where "id" = p_owner_id)
    when 'SCENARIO' then (select "programId" from public."Scenario" where "id" = p_owner_id)
  end
$$;

-- Used by the storage policies on bucket "exam-assets" (path = <programId>/<ownerId>/<file>).
-- Returns only true/false about the CALLER's own rights, so it is safe to grant to signed-in users.
create or replace function public.exam_storage_can(p_name text, p_action text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_program text := split_part(coalesce(p_name, ''), '/', 1);
begin
  if v_program = '' then return false; end if;
  if p_action = 'read' then
    -- staff of the course, or (phase 6) a learner whose own attempt contains this question / scenario
    return coalesce(public.exam_is_course_staff(v_program), false)
      or exists (select 1 from public."AttemptQuestion" q join public."ExamAttempt" a on a."id" = q."attemptId"
                 where a."memberId" = (public.exam_current_member())."id" and a."programId" = v_program
                   and split_part(p_name, '/', 2) in (q."questionId", q."scenarioId"));
  elsif p_action = 'write' then
    return coalesce(public.exam_instructor_can(v_program, 'canEditQuestions') or public.exam_instructor_can(v_program, 'canManageScenarios'), false);
  end if;
  return false;
end $$;

-- ── scenarios (browser-callable, staff of the course) ──

create or replace function public.exam_bank_scenarios(p_program text, p_filter jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_q text := nullif(trim(coalesce(p_filter ->> 'q', '')), '');
begin
  if not public.exam_is_course_staff(p_program) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', s."id", 'titleAr', s."titleAr", 'titleEn', s."titleEn", 'status', s."status",
      'displayMode', s."displayMode", 'version', s."version", 'updatedAt', s."updatedAt",
      'questions', (select count(*) from public."Question" q where q."scenarioId" = s."id"),
      'assets', (select count(*) from public."ExamAsset" a where a."ownerType" = 'SCENARIO' and a."ownerId" = s."id"))
      order by s."updatedAt" desc), '[]'::jsonb)
    from public."Scenario" s
    where s."programId" = p_program
      and (nullif(p_filter ->> 'status', '') is null or s."status" = p_filter ->> 'status')
      and (v_q is null or s."titleAr" ilike '%' || v_q || '%' or s."titleEn" ilike '%' || v_q || '%' or s."bodyAr" ilike '%' || v_q || '%')
  );
end $$;

create or replace function public.exam_bank_scenario(p_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_program text;
begin
  select "programId" into v_program from public."Scenario" where "id" = p_id;
  if v_program is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  if not public.exam_is_course_staff(v_program) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return public.exam_scenario_json(p_id) || jsonb_build_object(
    'questions', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', q."id", 'type', q."type", 'status', q."status", 'stemAr', left(q."stemAr", 220), 'stemEn', left(q."stemEn", 220),
        'points', q."points", 'scenarioOrder', q."scenarioOrder", 'version', q."version") order by q."scenarioOrder", q."createdAt"), '[]'::jsonb)
      from public."Question" q where q."scenarioId" = p_id));
end $$;

create or replace function public.exam_bank_scenario_save(p_program text, p_s jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me public."ExamMember" := public.exam_require_perm(p_program, 'canManageScenarios');
  v_id text := nullif(p_s ->> 'id', '');
  v_ar text := trim(coalesce(p_s ->> 'titleAr', ''));
  v_en text := trim(coalesce(p_s ->> 'titleEn', ''));
  v_mode text := coalesce(nullif(p_s ->> 'displayMode', ''), 'SIDE');
  v_status text := coalesce(nullif(p_s ->> 'status', ''), 'DRAFT');
  v_details jsonb; v_tables jsonb; cur public."Scenario"; v_version int;
begin
  if v_ar = '' and v_en = '' then raise exception 'invalid_scenario: title_missing'; end if;
  if char_length(v_ar) > 300 or char_length(v_en) > 300 then raise exception 'invalid_scenario: title_too_long'; end if;
  if char_length(coalesce(p_s ->> 'bodyAr', '')) > 30000 or char_length(coalesce(p_s ->> 'bodyEn', '')) > 30000 then
    raise exception 'invalid_scenario: body_too_long';
  end if;
  if v_mode not in ('SIDE', 'SECTION') then raise exception 'invalid_scenario: display_mode'; end if;
  if v_status not in ('DRAFT', 'ACTIVE', 'DISABLED') then raise exception 'invalid_scenario: status'; end if;
  v_details := public.exam_scenario_details(p_s -> 'details');
  v_tables := public.exam_scenario_tables(p_s -> 'tables');

  if v_id is null then
    insert into public."Scenario" ("programId", "titleAr", "titleEn", "bodyAr", "bodyEn", "details", "tables", "displayMode", "status", "createdById", "updatedById")
    values (p_program, v_ar, v_en, coalesce(p_s ->> 'bodyAr', ''), coalesce(p_s ->> 'bodyEn', ''), v_details, v_tables, v_mode, v_status, me."id", me."id")
    returning "id", "version" into v_id, v_version;
  else
    select * into cur from public."Scenario" where "id" = v_id;
    if cur."id" is null or cur."programId" <> p_program then raise exception 'not_found' using errcode = 'P0002'; end if;
    update public."Scenario" set "titleAr" = v_ar, "titleEn" = v_en, "bodyAr" = coalesce(p_s ->> 'bodyAr', ''), "bodyEn" = coalesce(p_s ->> 'bodyEn', ''),
      "details" = v_details, "tables" = v_tables, "displayMode" = v_mode, "status" = v_status,
      "version" = cur."version" + 1, "updatedById" = me."id", "updatedAt" = now()
    where "id" = v_id returning "version" into v_version;
  end if;

  insert into public."ScenarioVersion" ("scenarioId", "version", "snapshot", "createdById")
  values (v_id, v_version, public.exam_scenario_json(v_id), me."id");
  perform public.exam_log(case when v_version = 1 then 'scenario.create' else 'scenario.update' end, 'Scenario', v_id, p_program, jsonb_build_object('version', v_version));
  return public.exam_bank_scenario(v_id);
end $$;

create or replace function public.exam_bank_scenario_set_status(p_id text, p_status text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_program text; me public."ExamMember";
begin
  if p_status not in ('DRAFT', 'ACTIVE', 'DISABLED') then raise exception 'invalid_scenario: status'; end if;
  select "programId" into v_program from public."Scenario" where "id" = p_id;
  if v_program is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  me := public.exam_require_perm(v_program, 'canManageScenarios');
  update public."Scenario" set "status" = p_status, "updatedById" = me."id", "updatedAt" = now() where "id" = p_id;
  perform public.exam_log('scenario.status', 'Scenario', p_id, v_program, jsonb_build_object('status', p_status));
  return jsonb_build_object('id', p_id, 'status', p_status);
end $$;

-- Order of the questions inside a scenario: p_ids must be exactly the questions linked to it
create or replace function public.exam_bank_scenario_reorder(p_id text, p_ids jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_program text; v_linked text[]; v_given text[]; i int := 0; qid text;
begin
  select "programId" into v_program from public."Scenario" where "id" = p_id;
  if v_program is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  perform public.exam_require_perm(v_program, 'canManageScenarios');
  select coalesce(array_agg("id"), '{}') into v_linked from public."Question" where "scenarioId" = p_id;
  select coalesce(array_agg(x), '{}') into v_given from jsonb_array_elements_text(coalesce(p_ids, '[]'::jsonb)) x;
  if cardinality(v_given) <> cardinality(v_linked) or not (v_given @> v_linked and v_linked @> v_given) then
    raise exception 'invalid_scenario: reorder_mismatch';
  end if;
  foreach qid in array v_given loop
    i := i + 1;
    update public."Question" set "scenarioOrder" = i where "id" = qid;
  end loop;
  perform public.exam_log('scenario.reorder', 'Scenario', p_id, v_program, null);
  return public.exam_bank_scenario(p_id);
end $$;

-- Delete a scenario: only when no question is linked to it any more (unlink or move them first)
create or replace function public.exam_bank_scenario_delete(p_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare s public."Scenario"; v_paths jsonb;
begin
  select * into s from public."Scenario" where "id" = p_id;
  if s."id" is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  perform public.exam_require_perm(s."programId", 'canManageScenarios');
  if exists (select 1 from public."Question" where "scenarioId" = p_id) then
    raise exception 'scenario_in_use' using errcode = '23503';
  end if;
  select coalesce(jsonb_agg("path"), '[]'::jsonb) into v_paths from public."ExamAsset" where "ownerType" = 'SCENARIO' and "ownerId" = p_id;
  delete from public."ExamAsset" where "ownerType" = 'SCENARIO' and "ownerId" = p_id;
  delete from public."Scenario" where "id" = p_id;
  perform public.exam_log('scenario.delete', 'Scenario', p_id, s."programId", jsonb_build_object('titleAr', s."titleAr"));
  -- the browser removes these files from Storage (the delete policy allows course editors)
  return jsonb_build_object('deleted', p_id, 'paths', v_paths);
end $$;

-- ── attachments ──

-- record a file the editor has just uploaded to bucket "exam-assets"
create or replace function public.exam_asset_register(p_owner_type text, p_owner_id text, p_path text, p_mime text, p_size int, p_file_name text default '', p_caption_ar text default '', p_caption_en text default '')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_program text := public.exam_asset_owner_program(p_owner_type, p_owner_id); me public."ExamMember"; a public."ExamAsset";
begin
  if v_program is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  me := public.exam_require_perm(v_program, case when p_owner_type = 'SCENARIO' then 'canManageScenarios' else 'canEditQuestions' end);
  if p_path !~ ('^' || v_program || '/' || p_owner_id || '/[A-Za-z0-9-]{8,64}\.(png|jpg|jpeg|webp|gif|pdf)$') then
    raise exception 'invalid_asset: path';
  end if;
  if p_mime not in ('image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/pdf') then raise exception 'invalid_asset: type'; end if;
  if p_size is null or p_size <= 0 or p_size > 10485760 then raise exception 'invalid_asset: size'; end if;
  if (select count(*) from public."ExamAsset" where "ownerType" = p_owner_type and "ownerId" = p_owner_id) >= 20 then
    raise exception 'invalid_asset: max_20';
  end if;
  insert into public."ExamAsset" ("programId", "ownerType", "ownerId", "kind", "path", "mime", "size", "fileName", "captionAr", "captionEn", "sortOrder", "createdById")
  values (v_program, p_owner_type, p_owner_id, case when p_mime like 'image/%' then 'IMAGE' else 'FILE' end, p_path, p_mime, p_size,
    left(coalesce(p_file_name, ''), 200), left(coalesce(p_caption_ar, ''), 300), left(coalesce(p_caption_en, ''), 300),
    (select coalesce(max("sortOrder"), 0) + 1 from public."ExamAsset" where "ownerType" = p_owner_type and "ownerId" = p_owner_id), me."id")
  returning * into a;
  perform public.exam_log('asset.add', 'ExamAsset', a."id", v_program, jsonb_build_object('owner', p_owner_type, 'ownerId', p_owner_id, 'mime', p_mime));
  return to_jsonb(a);
end $$;

create or replace function public.exam_assets(p_owner_type text, p_owner_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_program text := public.exam_asset_owner_program(p_owner_type, p_owner_id);
begin
  if v_program is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  if not public.exam_is_course_staff(v_program) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return (select coalesce(jsonb_agg(to_jsonb(a) - 'programId' - 'createdById' order by a."sortOrder"), '[]'::jsonb)
          from public."ExamAsset" a where a."ownerType" = p_owner_type and a."ownerId" = p_owner_id);
end $$;

create or replace function public.exam_asset_update(p_id text, p_caption_ar text, p_caption_en text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare a public."ExamAsset";
begin
  select * into a from public."ExamAsset" where "id" = p_id;
  if a."id" is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  perform public.exam_require_perm(a."programId", case when a."ownerType" = 'SCENARIO' then 'canManageScenarios' else 'canEditQuestions' end);
  update public."ExamAsset" set "captionAr" = left(coalesce(p_caption_ar, ''), 300), "captionEn" = left(coalesce(p_caption_en, ''), 300)
  where "id" = p_id returning * into a;
  return to_jsonb(a);
end $$;

create or replace function public.exam_asset_delete(p_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare a public."ExamAsset";
begin
  select * into a from public."ExamAsset" where "id" = p_id;
  if a."id" is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  perform public.exam_require_perm(a."programId", case when a."ownerType" = 'SCENARIO' then 'canManageScenarios' else 'canEditQuestions' end);
  -- phase 10: an ACTIVE hotspot question keeps at least one image (its clickable picture)
  if a."ownerType" = 'QUESTION' and a."kind" = 'IMAGE'
     and exists (select 1 from public."Question" where "id" = a."ownerId" and "type" = 'HOTSPOT' and "status" = 'ACTIVE')
     and not exists (select 1 from public."ExamAsset" where "ownerType" = 'QUESTION' and "ownerId" = a."ownerId" and "kind" = 'IMAGE' and "id" <> p_id) then
    raise exception 'invalid_asset: hotspot_image_needed';
  end if;
  delete from public."ExamAsset" where "id" = p_id;
  perform public.exam_log('asset.delete', 'ExamAsset', p_id, a."programId", jsonb_build_object('path', a."path"));
  return jsonb_build_object('deleted', p_id, 'path', a."path");
end $$;

-- ── access ──
do $$
declare t text;
begin
  foreach t in array array['Scenario', 'ScenarioVersion', 'ExamAsset'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;

revoke all on function public.exam_scenario_json(text) from public, anon, authenticated;
revoke all on function public.exam_scenario_details(jsonb) from public, anon, authenticated;
revoke all on function public.exam_scenario_tables(jsonb) from public, anon, authenticated;
revoke all on function public.exam_asset_owner_program(text, text) from public, anon, authenticated;
revoke all on function public.exam_storage_can(text, text) from public, anon;
-- needed by the storage policies (supabase/exams-storage.sql), which run as the signed-in user
grant execute on function public.exam_storage_can(text, text) to authenticated;

revoke all on function public.exam_bank_scenarios(text, jsonb) from public, anon;
revoke all on function public.exam_bank_scenario(text) from public, anon;
revoke all on function public.exam_bank_scenario_save(text, jsonb) from public, anon;
revoke all on function public.exam_bank_scenario_set_status(text, text) from public, anon;
revoke all on function public.exam_bank_scenario_reorder(text, jsonb) from public, anon;
revoke all on function public.exam_bank_scenario_delete(text) from public, anon;
revoke all on function public.exam_asset_register(text, text, text, text, int, text, text, text) from public, anon;
revoke all on function public.exam_assets(text, text) from public, anon;
revoke all on function public.exam_asset_update(text, text, text) from public, anon;
revoke all on function public.exam_asset_delete(text) from public, anon;

grant execute on function public.exam_bank_scenarios(text, jsonb) to authenticated;
grant execute on function public.exam_bank_scenario(text) to authenticated;
grant execute on function public.exam_bank_scenario_save(text, jsonb) to authenticated;
grant execute on function public.exam_bank_scenario_set_status(text, text) to authenticated;
grant execute on function public.exam_bank_scenario_reorder(text, jsonb) to authenticated;
grant execute on function public.exam_bank_scenario_delete(text) to authenticated;
grant execute on function public.exam_asset_register(text, text, text, text, int, text, text, text) to authenticated;
grant execute on function public.exam_assets(text, text) to authenticated;
grant execute on function public.exam_asset_update(text, text, text) to authenticated;
grant execute on function public.exam_asset_delete(text) to authenticated;
