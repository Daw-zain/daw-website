-- ─────────────────────────────────────────────────────────────────────────────
-- Exam system · Phase 11 — import & export of questions.
-- Applied by `npm run supabase:setup` after exams-mistakes.sql (safe to run again).
--
--   • Files are read in the browser (Moodle XML, GIFT, Aiken, JSON, CSV, Excel) into the same question
--     shape the editor saves. The server trusts none of it: every question goes through
--     exam_bank_question_write — the exact validation the editor uses.
--   • exam_bank_import_check = dry run: each question is written inside a sub-transaction that is then
--     rolled back, so the preview reports exactly what the real import would accept or refuse.
--   • exam_bank_import: each question in its own sub-transaction — one failure never spoils the rest.
--   • Import needs canImport; export needs canExport (admins: both). Both are written to the audit log.
-- ─────────────────────────────────────────────────────────────────────────────

-- text used to spot duplicates: no Arabic diacritics/tatweel, unified alef/yaa/taa marbuta, no punctuation, single spaces
create or replace function public.exam_import_norm(p text)
returns text
language sql
immutable
set search_path = public
as $$
  select trim(regexp_replace(regexp_replace(
    translate(lower(coalesce(p, '')), 'أإآٱىةـ', 'اااايه'),
    '[ً-ْٰ]', '', 'g'),
    '[^[:alnum:]ء-ي٠-٩]+', ' ', 'g'))
$$;

-- category names from a file → ids in this course (optionally creating the missing ones)
create or replace function public.exam_import_category(p_program text, p_names jsonb, p_create boolean, p_me public."ExamMember")
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_kinds text[] := array['DOMAIN', 'TOPIC', 'SUBTOPIC'];
  v_keys text[] := array['domain', 'topic', 'subtopic'];
  v_parent text := null; v_id text; v_name text; v_missing jsonb := '[]'::jsonb; v_created int := 0;
  v_out jsonb := '{}'::jsonb; i int;
begin
  if p_names is null or jsonb_typeof(p_names) <> 'object' then return jsonb_build_object('ids', '{}'::jsonb, 'missing', '[]'::jsonb, 'created', 0); end if;
  for i in 1..3 loop
    v_name := left(trim(coalesce(p_names ->> v_keys[i], '')), 200);
    exit when v_name = '';
    select "id" into v_id from public."QuestionCategory"
      where "programId" = p_program and "kind" = v_kinds[i] and "parentId" is not distinct from v_parent
        and (lower(trim("nameAr")) = lower(v_name) or lower(trim("nameEn")) = lower(v_name))
      order by "sortOrder" limit 1;
    if v_id is null then
      if not p_create then
        v_missing := v_missing || to_jsonb(v_name);
        exit;
      end if;
      insert into public."QuestionCategory" ("programId", "parentId", "kind", "nameAr", "nameEn", "sortOrder", "createdById")
      values (p_program, v_parent, v_kinds[i],
        case when v_name ~ '[؀-ۿ]' then v_name else '' end,
        case when v_name ~ '[؀-ۿ]' then '' else v_name end,
        (select coalesce(max("sortOrder"), 0) + 1 from public."QuestionCategory" where "programId" = p_program and "parentId" is not distinct from v_parent),
        p_me."id")
      returning "id" into v_id;
      v_created := v_created + 1;
    end if;
    v_out := v_out || jsonb_build_object(v_keys[i] || 'Id', v_id);
    v_parent := v_id;
    v_id := null;
  end loop;
  return jsonb_build_object('ids', v_out, 'missing', v_missing, 'created', v_created);
end $$;

-- one file question → the payload exam_bank_question_write expects (never an existing id)
create or replace function public.exam_import_prepare(p_item jsonb, p_options jsonb, p_cat jsonb)
returns jsonb
language plpgsql
immutable
set search_path = public
as $$
declare
  v jsonb := (p_item - 'id' - 'version' - 'category' - 'scenario' - 'scenarioId' - 'attachments' - 'programId' - 'createdAt' - 'updatedAt');
  v_status text := case when p_options ->> 'status' = 'ACTIVE' then 'ACTIVE' else 'DRAFT' end;
begin
  -- a hotspot's image only comes after the question exists → it always starts as a draft
  if v ->> 'type' = 'HOTSPOT' then v_status := 'DRAFT'; end if;
  v := v || jsonb_build_object('status', v_status, 'scenarioId', null);
  if p_cat -> 'ids' ? 'domainId' then
    v := v || jsonb_build_object('domainId', p_cat -> 'ids' ->> 'domainId', 'topicId', p_cat -> 'ids' ->> 'topicId', 'subtopicId', p_cat -> 'ids' ->> 'subtopicId');
  else
    v := v || jsonb_build_object('domainId', nullif(p_options ->> 'domainId', ''), 'topicId', nullif(p_options ->> 'topicId', ''), 'subtopicId', nullif(p_options ->> 'subtopicId', ''));
  end if;
  -- numbers may arrive as JSON numbers; the writer wants the editor's text form
  if jsonb_typeof(v -> 'points') = 'number' then v := v || jsonb_build_object('points', v ->> 'points'); end if;
  if jsonb_typeof(v -> 'weight') = 'number' then v := v || jsonb_build_object('weight', v ->> 'weight'); end if;
  return v;
end $$;

-- duplicate of a question already in the bank? (same type + same normalised stem)
create or replace function public.exam_import_duplicate(p_program text, p_item jsonb)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select q."id" from public."Question" q
  where q."programId" = p_program and q."type" = p_item ->> 'type'
    and ((public.exam_import_norm(p_item ->> 'stemAr') <> '' and public.exam_import_norm(q."stemAr") = public.exam_import_norm(p_item ->> 'stemAr'))
      or (public.exam_import_norm(p_item ->> 'stemEn') <> '' and public.exam_import_norm(q."stemEn") = public.exam_import_norm(p_item ->> 'stemEn')))
  limit 1
$$;

-- ── browser-callable ──

-- Preview: validate every question exactly as the import would, without keeping anything
create or replace function public.exam_bank_import_check(p_program text, p_items jsonb, p_options jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me public."ExamMember" := public.exam_require_perm(p_program, 'canImport');
  it jsonb; i int := 0; v_cat jsonb; v_err text; v_ok boolean; v_dup text; v_dupfile int;
  v_seen jsonb := '{}'::jsonb; v_key text; v_out jsonb := '[]'::jsonb; n_ok int := 0; n_bad int := 0; n_dup int := 0;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' then raise exception 'invalid_import: items'; end if;
  if jsonb_array_length(p_items) > 500 then raise exception 'invalid_import: max_500'; end if;
  for it in select value from jsonb_array_elements(p_items) loop
    v_err := null; v_ok := false; v_dupfile := null;
    v_cat := public.exam_import_category(p_program, it -> 'category', false, me);
    begin
      perform public.exam_bank_question_write(p_program, public.exam_import_prepare(it, p_options, v_cat), me);
      raise exception '__dry_run_ok__';
    exception when others then
      if sqlerrm = '__dry_run_ok__' then v_ok := true; else v_err := sqlerrm; end if;
    end;
    v_dup := public.exam_import_duplicate(p_program, it);
    v_key := (it ->> 'type') || '|' || public.exam_import_norm(coalesce(nullif(it ->> 'stemAr', ''), it ->> 'stemEn'));
    if v_seen ? v_key then v_dupfile := (v_seen ->> v_key)::int; else v_seen := v_seen || jsonb_build_object(v_key, i); end if;
    if v_ok then n_ok := n_ok + 1; else n_bad := n_bad + 1; end if;
    if v_dup is not null or v_dupfile is not null then n_dup := n_dup + 1; end if;
    v_out := v_out || jsonb_build_array(jsonb_build_object('index', i, 'ok', v_ok, 'error', v_err,
      'duplicateOf', v_dup, 'duplicateInFile', v_dupfile, 'categoryMissing', v_cat -> 'missing',
      'scenario', it -> 'scenario' ->> 'key'));
    i := i + 1;
  end loop;
  return jsonb_build_object('items', v_out, 'counts', jsonb_build_object('total', i, 'valid', n_ok, 'invalid', n_bad, 'duplicates', n_dup),
    'can', jsonb_build_object('categories', public.exam_instructor_can(p_program, 'canManageCategories'), 'scenarios', public.exam_instructor_can(p_program, 'canManageScenarios')));
end $$;

-- Import the chosen questions. Each in its own sub-transaction; returns one result per question.
create or replace function public.exam_bank_import(p_program text, p_items jsonb, p_options jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me public."ExamMember" := public.exam_require_perm(p_program, 'canImport');
  v_cat_ok boolean := coalesce((p_options ->> 'createCategories')::boolean, false) and public.exam_instructor_can(p_program, 'canManageCategories');
  v_scn_ok boolean := public.exam_instructor_can(p_program, 'canManageScenarios');
  v_skip_dup boolean := coalesce((p_options ->> 'skipDuplicates')::boolean, true);
  it jsonb; i int := 0; v_cat jsonb; v_q jsonb; v_res jsonb; v_out jsonb := '[]'::jsonb; v_warn jsonb;
  v_scn jsonb := '{}'::jsonb; v_skey text; v_sid text; v_saved jsonb;
  n_ok int := 0; n_bad int := 0; n_skip int := 0; n_cats int := 0; n_scn int := 0;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' then raise exception 'invalid_import: items'; end if;
  if jsonb_array_length(p_items) > 500 then raise exception 'invalid_import: max_500'; end if;
  for it in select value from jsonb_array_elements(p_items) loop
    v_warn := '[]'::jsonb; v_skey := null;
    if v_skip_dup and public.exam_import_duplicate(p_program, it) is not null then
      v_out := v_out || jsonb_build_array(jsonb_build_object('index', i, 'ok', false, 'skipped', true, 'error', 'duplicate'));
      n_skip := n_skip + 1; i := i + 1;
      continue;
    end if;
    begin
      v_cat := public.exam_import_category(p_program, it -> 'category', v_cat_ok, me);
      if jsonb_array_length(v_cat -> 'missing') > 0 then v_warn := v_warn || '"category_missing"'::jsonb; end if;
      v_q := public.exam_import_prepare(it, p_options, v_cat);
      -- scenario (our JSON format only): created once per key, if the caller may manage scenarios
      v_skey := nullif(it -> 'scenario' ->> 'key', '');
      if v_skey is not null then
        if not v_scn_ok then
          v_warn := v_warn || '"scenario_skipped"'::jsonb;
        else
          v_sid := v_scn ->> v_skey;
          if v_sid is null then
            v_saved := public.exam_bank_scenario_save(p_program, (it -> 'scenario') - 'key' - 'id' || jsonb_build_object('status', 'DRAFT'));
            v_sid := v_saved ->> 'id';
            v_scn := v_scn || jsonb_build_object(v_skey, v_sid);
            n_scn := n_scn + 1;
          end if;
          v_q := v_q || jsonb_build_object('scenarioId', v_sid);
        end if;
      end if;
      v_res := public.exam_bank_question_write(p_program, v_q, me);
      n_cats := n_cats + coalesce((v_cat ->> 'created')::int, 0);
      v_out := v_out || jsonb_build_array(jsonb_build_object('index', i, 'ok', true, 'id', v_res ->> 'id', 'type', v_res ->> 'type', 'warnings', v_warn));
      n_ok := n_ok + 1;
    exception when others then
      -- a scenario created in this sub-transaction is rolled back with it → forget it
      if v_skey is not null and v_scn ? v_skey and not exists (select 1 from public."Scenario" where "id" = v_scn ->> v_skey) then
        v_scn := v_scn - v_skey; n_scn := n_scn - 1;
      end if;
      v_out := v_out || jsonb_build_array(jsonb_build_object('index', i, 'ok', false, 'error', sqlerrm));
      n_bad := n_bad + 1;
    end;
    i := i + 1;
  end loop;
  perform public.exam_log('question.import', 'Question', null, p_program, jsonb_build_object(
    'format', left(coalesce(p_options ->> 'format', ''), 20), 'file', left(coalesce(p_options ->> 'fileName', ''), 200),
    'imported', n_ok, 'failed', n_bad, 'skipped', n_skip, 'categoriesCreated', n_cats, 'scenariosCreated', n_scn));
  return jsonb_build_object('results', v_out,
    'counts', jsonb_build_object('imported', n_ok, 'failed', n_bad, 'skipped', n_skip, 'categoriesCreated', n_cats, 'scenariosCreated', n_scn));
end $$;

-- Export: full questions (incl. answers, feedback, explanation) of the whole bank, one category or a set
create or replace function public.exam_bank_export(p_program text, p_filter jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me public."ExamMember" := public.exam_require_perm(p_program, 'canExport');
  v_ids text[]; v_cat text := nullif(p_filter ->> 'categoryId', ''); v_out jsonb;
begin
  if jsonb_typeof(p_filter -> 'ids') = 'array' then
    select array_agg(x) into v_ids from jsonb_array_elements_text(p_filter -> 'ids') x;
  end if;
  select coalesce(jsonb_agg(public.exam_bank_question_json(q."id") || jsonb_build_object(
      'category', jsonb_strip_nulls(jsonb_build_object(
        'domain', (select coalesce(nullif(c."nameAr", ''), c."nameEn") from public."QuestionCategory" c where c."id" = q."domainId"),
        'topic', (select coalesce(nullif(c."nameAr", ''), c."nameEn") from public."QuestionCategory" c where c."id" = q."topicId"),
        'subtopic', (select coalesce(nullif(c."nameAr", ''), c."nameEn") from public."QuestionCategory" c where c."id" = q."subtopicId"))),
      'scenario', case when q."scenarioId" is not null then
        (select jsonb_build_object('key', s."id", 'titleAr', s."titleAr", 'titleEn', s."titleEn", 'bodyAr', s."bodyAr", 'bodyEn', s."bodyEn",
           'details', s."details", 'tables', s."tables", 'displayMode', s."displayMode") from public."Scenario" s where s."id" = q."scenarioId") end,
      'attachments', (select coalesce(jsonb_agg(jsonb_build_object('path', a."path", 'mime', a."mime", 'fileName', a."fileName",
           'captionAr', a."captionAr", 'captionEn', a."captionEn", 'kind', a."kind") order by a."sortOrder"), '[]'::jsonb)
         from public."ExamAsset" a where a."ownerType" = 'QUESTION' and a."ownerId" = q."id"))
    order by q."domainId" nulls last, q."topicId" nulls last, q."scenarioId" nulls first, q."scenarioOrder", q."createdAt"), '[]'::jsonb)
  into v_out
  from public."Question" q
  where q."programId" = p_program
    and (v_ids is null or q."id" = any(v_ids))
    and (v_cat is null or v_cat in (q."domainId", q."topicId", q."subtopicId"))
    and (nullif(p_filter ->> 'status', '') is null or q."status" = p_filter ->> 'status')
    and (nullif(p_filter ->> 'type', '') is null or q."type" = p_filter ->> 'type');
  if jsonb_array_length(v_out) > 3000 then raise exception 'invalid_export: max_3000'; end if;
  perform public.exam_log('question.export', 'Question', null, p_program, jsonb_build_object(
    'count', jsonb_array_length(v_out), 'format', left(coalesce(p_filter ->> 'format', ''), 20),
    'scope', case when v_ids is not null then 'selection' when v_cat is not null then 'category' else 'bank' end, 'categoryId', v_cat));
  return jsonb_build_object('questions', v_out);
end $$;

-- ── access ──
revoke all on function public.exam_import_norm(text) from public, anon, authenticated;
revoke all on function public.exam_import_category(text, jsonb, boolean, public."ExamMember") from public, anon, authenticated;
revoke all on function public.exam_import_prepare(jsonb, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.exam_import_duplicate(text, jsonb) from public, anon, authenticated;
revoke all on function public.exam_bank_import_check(text, jsonb, jsonb) from public, anon;
revoke all on function public.exam_bank_import(text, jsonb, jsonb) from public, anon;
revoke all on function public.exam_bank_export(text, jsonb) from public, anon;
grant execute on function public.exam_bank_import_check(text, jsonb, jsonb) to authenticated;
grant execute on function public.exam_bank_import(text, jsonb, jsonb) to authenticated;
grant execute on function public.exam_bank_export(text, jsonb) to authenticated;
