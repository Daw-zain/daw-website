-- ─────────────────────────────────────────────────────────────────────────────
-- Exam system · Phase 3 — question bank (one per course).
-- Applied by `npm run supabase:setup` after exams.sql (safe to run again).
--
--   • Only staff of a course (admin, or an instructor assigned to that course) can read its bank.
--   • Writing needs the instructor permission for the action (canEditQuestions, canDeleteQuestions,
--     canManageCategories) — admins can do everything.
--   • The answer, scoring rules, feedback, explanation and option rationale live in "QuestionSecret".
--     Staff see them in the bank editor; learners never reach these functions, and later phases deliver
--     questions to learners through separate functions that never select from "QuestionSecret".
--   • Every save writes a full snapshot to "QuestionVersion" so later edits never change past attempts.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── helpers (not callable from the browser) ──

-- admin, or any instructor assigned to the course.
-- coalesce matters: exam_course_access() is NULL for people with no relation to the course,
-- and `if not NULL` would NOT refuse them (caught by scripts/test-exams-bank.mjs).
create or replace function public.exam_is_course_staff(p_program text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.exam_course_access(p_program) in ('ADMIN', 'INSTRUCTOR'), false)
$$;

create or replace function public.exam_require_perm(p_program text, p_perm text)
returns public."ExamMember"
language plpgsql
stable
security definer
set search_path = public
as $$
declare me public."ExamMember" := public.exam_current_member();
begin
  if me."id" is null or not public.exam_instructor_can(p_program, p_perm) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return me;
end $$;

-- normalise a list of {id, textAr, textEn}; ids are kept (the editor generates them) or created
create or replace function public.exam_bank_list(p jsonb, p_min int, p_what text)
returns jsonb
language plpgsql
immutable
set search_path = public
as $$
declare r jsonb; v_out jsonb := '[]'::jsonb; v_ids text[] := '{}'; v_id text; v_ar text; v_en text; i int := 0;
begin
  if p is null or jsonb_typeof(p) <> 'array' then
    raise exception 'invalid_question: %_missing', p_what;
  end if;
  for r in select value from jsonb_array_elements(p) loop
    i := i + 1;
    v_id := coalesce(nullif(trim(r ->> 'id'), ''), p_what || i::text);
    if v_id !~ '^[A-Za-z0-9_-]{1,40}$' then raise exception 'invalid_question: %_bad_id', p_what; end if;
    if v_id = any(v_ids) then raise exception 'invalid_question: %_duplicate_id', p_what; end if;
    v_ar := coalesce(trim(r ->> 'textAr'), '');
    v_en := coalesce(trim(r ->> 'textEn'), '');
    if v_ar = '' and v_en = '' then raise exception 'invalid_question: %_empty_text', p_what; end if;
    if char_length(v_ar) > 2000 or char_length(v_en) > 2000 then raise exception 'invalid_question: %_too_long', p_what; end if;
    v_ids := v_ids || v_id;
    v_out := v_out || jsonb_build_array(jsonb_build_object('id', v_id, 'textAr', v_ar, 'textEn', v_en));
  end loop;
  if i < p_min then raise exception 'invalid_question: %_min_%', p_what, p_min; end if;
  if i > 30 then raise exception 'invalid_question: %_max_30', p_what; end if;
  return v_out;
end $$;

-- validate + normalise the type-specific parts. Returns {content, answer, scoring}.
create or replace function public.exam_bank_validate(p_type text, p_content jsonb, p_answer jsonb, p_scoring jsonb)
returns jsonb
language plpgsql
immutable
set search_path = public
as $$
declare
  c jsonb := coalesce(p_content, '{}'::jsonb);
  a jsonb := coalesce(p_answer, '{}'::jsonb);
  s jsonb := coalesce(p_scoring, '{}'::jsonb);
  opts jsonb; lft jsonb; rgt jsonb; ids text[]; rids text[]; sel text[]; v_mode text; k text; v text; used text[] := '{}';
  v_num numeric; v_tol numeric; v_acc jsonb; v_min int; v_max int;
  v_r jsonb; v_i bigint; v_tar text; v_ten text;
begin
  v_mode := coalesce(nullif(s ->> 'mode', ''), 'ALL_OR_NOTHING');

  case p_type
  when 'MCQ', 'MULTI' then
    opts := public.exam_bank_list(c -> 'options', 2, 'options');
    select array_agg(o ->> 'id') into ids from jsonb_array_elements(opts) o;
    if coalesce(jsonb_typeof(a -> 'correct'), '') <> 'array' then raise exception 'invalid_question: correct_missing'; end if;
    select array_agg(distinct x) into sel from jsonb_array_elements_text(a -> 'correct') x;
    if sel is null then raise exception 'invalid_question: correct_missing'; end if;
    if not sel <@ ids then raise exception 'invalid_question: correct_unknown_option'; end if;
    if p_type = 'MCQ' and cardinality(sel) <> 1 then raise exception 'invalid_question: mcq_one_correct'; end if;
    if p_type = 'MULTI' and cardinality(sel) = cardinality(ids) then raise exception 'invalid_question: multi_not_all_correct'; end if;
    if p_type = 'MULTI' and v_mode not in ('ALL_OR_NOTHING', 'PARTIAL', 'PARTIAL_PENALTY') then raise exception 'invalid_question: scoring_mode'; end if;
    return jsonb_build_object(
      'content', jsonb_build_object('options', opts),
      'answer', jsonb_build_object('correct', to_jsonb(sel)),
      'scoring', case when p_type = 'MULTI' then jsonb_build_object('mode', v_mode) else jsonb_build_object('mode', 'ALL_OR_NOTHING') end);

  when 'TRUE_FALSE' then
    if coalesce(jsonb_typeof(a -> 'value'), '') <> 'boolean' then raise exception 'invalid_question: tf_value_missing'; end if;
    return jsonb_build_object('content', '{}'::jsonb, 'answer', jsonb_build_object('value', a -> 'value'), 'scoring', jsonb_build_object('mode', 'ALL_OR_NOTHING'));

  when 'NUMERIC' then
    if coalesce(jsonb_typeof(a -> 'value'), '') <> 'number' then raise exception 'invalid_question: numeric_value_missing'; end if;
    v_num := (a ->> 'value')::numeric;
    v_tol := coalesce((a ->> 'tolerance')::numeric, 0);
    if v_tol < 0 then raise exception 'invalid_question: numeric_tolerance'; end if;
    return jsonb_build_object(
      'content', jsonb_build_object('unitAr', coalesce(trim(c ->> 'unitAr'), ''), 'unitEn', coalesce(trim(c ->> 'unitEn'), '')),
      'answer', jsonb_build_object('value', v_num, 'tolerance', v_tol),
      'scoring', jsonb_build_object('mode', 'ALL_OR_NOTHING'));

  when 'SHORT' then
    select jsonb_agg(trim(x)) into v_acc from jsonb_array_elements_text(coalesce(a -> 'accepted', '[]'::jsonb)) x where trim(x) <> '';
    if v_acc is null then raise exception 'invalid_question: short_accepted_missing'; end if;
    if jsonb_array_length(v_acc) > 20 then raise exception 'invalid_question: short_accepted_max_20'; end if;
    return jsonb_build_object(
      'content', '{}'::jsonb,
      'answer', jsonb_build_object('accepted', v_acc, 'caseSensitive', coalesce((a ->> 'caseSensitive')::boolean, false)),
      'scoring', jsonb_build_object('mode', 'ALL_OR_NOTHING'));

  when 'ESSAY' then
    v_min := nullif(c ->> 'minWords', '')::int;
    v_max := nullif(c ->> 'maxWords', '')::int;
    if (v_min is not null and v_min < 0) or (v_max is not null and v_max < 1) or (v_min is not null and v_max is not null and v_min > v_max) then
      raise exception 'invalid_question: essay_word_limits';
    end if;
    return jsonb_build_object(
      'content', jsonb_strip_nulls(jsonb_build_object('minWords', v_min, 'maxWords', v_max)),
      'answer', jsonb_build_object('rubricAr', coalesce(a ->> 'rubricAr', ''), 'rubricEn', coalesce(a ->> 'rubricEn', '')),
      'scoring', jsonb_build_object('mode', 'MANUAL'));

  when 'ORDERING' then
    opts := public.exam_bank_list(c -> 'items', 2, 'items');
    select array_agg(o ->> 'id') into ids from jsonb_array_elements(opts) o;
    if coalesce(jsonb_typeof(a -> 'order'), '') <> 'array' then raise exception 'invalid_question: order_missing'; end if;
    select array_agg(x) into sel from jsonb_array_elements_text(a -> 'order') x;
    if sel is null or cardinality(sel) <> cardinality(ids) or not (sel @> ids and ids @> sel) then
      raise exception 'invalid_question: order_not_permutation';
    end if;
    if v_mode not in ('ALL_OR_NOTHING', 'PARTIAL') then raise exception 'invalid_question: scoring_mode'; end if;
    return jsonb_build_object('content', jsonb_build_object('items', opts), 'answer', jsonb_build_object('order', to_jsonb(sel)), 'scoring', jsonb_build_object('mode', v_mode));

  when 'MATCHING' then
    lft := public.exam_bank_list(c -> 'left', 2, 'left');
    rgt := public.exam_bank_list(c -> 'right', jsonb_array_length(lft), 'right');
    select array_agg(o ->> 'id') into ids from jsonb_array_elements(lft) o;
    select array_agg(o ->> 'id') into rids from jsonb_array_elements(rgt) o;
    if coalesce(jsonb_typeof(a -> 'pairs'), '') <> 'object' then raise exception 'invalid_question: pairs_missing'; end if;
    for k in select unnest(ids) loop
      v := a -> 'pairs' ->> k;
      if v is null then raise exception 'invalid_question: pairs_incomplete'; end if;
      if not v = any(rids) then raise exception 'invalid_question: pairs_unknown_right'; end if;
      if v = any(used) then raise exception 'invalid_question: pairs_duplicate_right'; end if;
      used := used || v;
    end loop;
    if v_mode not in ('ALL_OR_NOTHING', 'PARTIAL') then raise exception 'invalid_question: scoring_mode'; end if;
    return jsonb_build_object(
      'content', jsonb_build_object('left', lft, 'right', rgt),
      'answer', jsonb_build_object('pairs', (select jsonb_object_agg(x, a -> 'pairs' ->> x) from unnest(ids) x)),
      'scoring', jsonb_build_object('mode', v_mode));

  -- ── phase 10: advanced types ──
  when 'HOTSPOT' then
    -- correct areas on the question's first image, as % of its width/height (secret: they ARE the answer)
    if coalesce(jsonb_typeof(a -> 'regions'), '') <> 'array' or jsonb_array_length(a -> 'regions') = 0 then raise exception 'invalid_question: hotspot_regions_missing'; end if;
    if jsonb_array_length(a -> 'regions') > 10 then raise exception 'invalid_question: hotspot_regions_max_10'; end if;
    v_acc := '[]'::jsonb; ids := '{}';
    for v_r, v_i in select x, n from jsonb_array_elements(a -> 'regions') with ordinality t(x, n) loop
      k := coalesce(nullif(trim(v_r ->> 'id'), ''), 'r' || v_i::text);
      if k !~ '^[A-Za-z0-9_-]{1,40}$' or k = any(ids) then raise exception 'invalid_question: hotspot_region_bad'; end if;
      if jsonb_typeof(v_r -> 'x') <> 'number' or jsonb_typeof(v_r -> 'y') <> 'number' or jsonb_typeof(v_r -> 'w') <> 'number' or jsonb_typeof(v_r -> 'h') <> 'number' then
        raise exception 'invalid_question: hotspot_region_bad';
      end if;
      if (v_r ->> 'x')::numeric < 0 or (v_r ->> 'y')::numeric < 0 or (v_r ->> 'w')::numeric < 1 or (v_r ->> 'h')::numeric < 1
         or (v_r ->> 'x')::numeric + (v_r ->> 'w')::numeric > 100.01 or (v_r ->> 'y')::numeric + (v_r ->> 'h')::numeric > 100.01 then
        raise exception 'invalid_question: hotspot_region_bad';
      end if;
      ids := ids || k;
      v_acc := v_acc || jsonb_build_array(jsonb_build_object('id', k,
        'x', round((v_r ->> 'x')::numeric, 2), 'y', round((v_r ->> 'y')::numeric, 2), 'w', round((v_r ->> 'w')::numeric, 2), 'h', round((v_r ->> 'h')::numeric, 2)));
    end loop;
    if v_mode not in ('ALL_OR_NOTHING', 'PARTIAL', 'PARTIAL_PENALTY') then raise exception 'invalid_question: scoring_mode'; end if;
    return jsonb_build_object('content', '{}'::jsonb, 'answer', jsonb_build_object('regions', v_acc), 'scoring', jsonb_build_object('mode', v_mode));

  when 'DRAGDROP' then
    -- items are dropped into zones; a zone may take several items; items with no zone are distractors
    opts := public.exam_bank_list(c -> 'items', 2, 'items');
    rgt := public.exam_bank_list(c -> 'zones', 1, 'zones');
    if jsonb_array_length(rgt) > 10 then raise exception 'invalid_question: zones_max_10'; end if;
    select array_agg(o ->> 'id') into ids from jsonb_array_elements(opts) o;
    select array_agg(o ->> 'id') into rids from jsonb_array_elements(rgt) o;
    if coalesce(jsonb_typeof(a -> 'placements'), '') <> 'object' then raise exception 'invalid_question: placements_missing'; end if;
    for k, v in select key, value #>> '{}' from jsonb_each(a -> 'placements') loop
      if not k = any(ids) then raise exception 'invalid_question: placements_unknown_item'; end if;
      if v is null or not v = any(rids) then raise exception 'invalid_question: placements_unknown_zone'; end if;
    end loop;
    if not exists (select 1 from jsonb_object_keys(a -> 'placements')) then raise exception 'invalid_question: placements_missing'; end if;
    if v_mode not in ('ALL_OR_NOTHING', 'PARTIAL', 'PARTIAL_PENALTY') then raise exception 'invalid_question: scoring_mode'; end if;
    return jsonb_build_object(
      'content', jsonb_build_object('items', opts, 'zones', rgt),
      'answer', jsonb_build_object('placements', a -> 'placements'),
      'scoring', jsonb_build_object('mode', v_mode));

  when 'CLOZE' then
    -- a passage with [[id]] markers; each marker is a drop-down (SELECT) or a typed answer (TEXT)
    v_tar := trim(coalesce(c ->> 'textAr', ''));
    v_ten := trim(coalesce(c ->> 'textEn', ''));
    if v_tar = '' and v_ten = '' then raise exception 'invalid_question: cloze_text_missing'; end if;
    if char_length(v_tar) > 10000 or char_length(v_ten) > 10000 then raise exception 'invalid_question: cloze_text_too_long'; end if;
    if coalesce(jsonb_typeof(c -> 'blanks'), '') <> 'array' or jsonb_array_length(c -> 'blanks') = 0 then raise exception 'invalid_question: cloze_blanks_missing'; end if;
    if jsonb_array_length(c -> 'blanks') > 20 then raise exception 'invalid_question: cloze_blanks_max_20'; end if;
    v_acc := '[]'::jsonb; lft := '{}'::jsonb; ids := '{}';
    for v_r in select x from jsonb_array_elements(c -> 'blanks') x loop
      k := trim(coalesce(v_r ->> 'id', ''));
      if k !~ '^[A-Za-z0-9_-]{1,20}$' or k = any(ids) then raise exception 'invalid_question: cloze_blank_id'; end if;
      ids := ids || k;
      for v in select unnest(array[v_tar, v_ten]) loop
        if v <> '' and (char_length(v) - char_length(replace(v, '[[' || k || ']]', ''))) / char_length('[[' || k || ']]') <> 1 then
          raise exception 'invalid_question: cloze_marker_missing';
        end if;
      end loop;
      if v_r ->> 'kind' = 'SELECT' then
        opts := public.exam_bank_list(v_r -> 'options', 2, 'options');
        v := a -> 'blanks' -> k ->> 'correct';
        if v is null or not exists (select 1 from jsonb_array_elements(opts) o where o ->> 'id' = v) then raise exception 'invalid_question: cloze_blank_answer'; end if;
        v_acc := v_acc || jsonb_build_array(jsonb_build_object('id', k, 'kind', 'SELECT', 'options', opts));
        lft := lft || jsonb_build_object(k, jsonb_build_object('correct', v));
      elsif v_r ->> 'kind' = 'TEXT' then
        select jsonb_agg(trim(x)) into rgt from jsonb_array_elements_text(coalesce(a -> 'blanks' -> k -> 'accepted', '[]'::jsonb)) x where trim(x) <> '';
        if rgt is null then raise exception 'invalid_question: cloze_blank_answer'; end if;
        if jsonb_array_length(rgt) > 20 then raise exception 'invalid_question: short_accepted_max_20'; end if;
        v_acc := v_acc || jsonb_build_array(jsonb_build_object('id', k, 'kind', 'TEXT'));
        lft := lft || jsonb_build_object(k, jsonb_build_object('accepted', rgt, 'caseSensitive', coalesce((a -> 'blanks' -> k ->> 'caseSensitive')::boolean, false)));
      else
        raise exception 'invalid_question: cloze_blank_kind';
      end if;
    end loop;
    -- no stray markers that point at nothing
    if exists (select 1 from regexp_matches(v_tar || ' ' || v_ten, '\[\[([^\]]*)\]\]', 'g') m where not m[1] = any(ids)) then
      raise exception 'invalid_question: cloze_marker_unknown';
    end if;
    if v_mode not in ('ALL_OR_NOTHING', 'PARTIAL') then raise exception 'invalid_question: scoring_mode'; end if;
    return jsonb_build_object(
      'content', jsonb_build_object('textAr', v_tar, 'textEn', v_ten, 'blanks', v_acc),
      'answer', jsonb_build_object('blanks', lft),
      'scoring', jsonb_build_object('mode', v_mode));

  else
    raise exception 'invalid_question: unknown_type';
  end case;
end $$;

-- ── phase 10: graphic-based questions — an optional table or chart (bar / line / pie) on any question.
-- rows[0] is the header; for charts column 1 holds the labels and the other columns numbers (series).
create or replace function public.exam_bank_figure(p jsonb)
returns jsonb
language plpgsql
immutable
set search_path = public
as $$
declare v_kind text; v_rows jsonb := '[]'::jsonb; r jsonb; v_cols int; i int := 0; cell text; v_row jsonb;
begin
  if p is null or p = 'null'::jsonb then return null; end if;
  if jsonb_typeof(p) <> 'object' then raise exception 'invalid_question: figure_bad'; end if;
  v_kind := coalesce(p ->> 'kind', 'TABLE');
  if v_kind not in ('TABLE', 'BAR', 'LINE', 'PIE') then raise exception 'invalid_question: figure_kind'; end if;
  if coalesce(jsonb_typeof(p -> 'rows'), '') <> 'array' or jsonb_array_length(p -> 'rows') < 2 or jsonb_array_length(p -> 'rows') > 31 then
    raise exception 'invalid_question: figure_rows';
  end if;
  for r in select x from jsonb_array_elements(p -> 'rows') x loop
    i := i + 1;
    if jsonb_typeof(r) <> 'array' then raise exception 'invalid_question: figure_columns'; end if;
    if v_cols is null then v_cols := jsonb_array_length(r); end if;
    if jsonb_array_length(r) <> v_cols or v_cols < 2 or v_cols > 10 then raise exception 'invalid_question: figure_columns'; end if;
    v_row := '[]'::jsonb;
    for cell in select trim(coalesce(x #>> '{}', '')) from jsonb_array_elements(r) x loop
      if char_length(cell) > 200 then raise exception 'invalid_question: figure_cell_too_long'; end if;
      v_row := v_row || to_jsonb(cell);
    end loop;
    v_rows := v_rows || jsonb_build_array(v_row);
  end loop;
  if v_kind <> 'TABLE' and exists (
      select 1 from jsonb_array_elements(v_rows) with ordinality t(rw, n), jsonb_array_elements_text(rw) with ordinality c(v, m)
      where n > 1 and m > 1 and v !~ '^-?\d+(\.\d+)?$') then
    raise exception 'invalid_question: figure_not_numeric';
  end if;
  if v_kind = 'PIE' and exists (
      select 1 from jsonb_array_elements(v_rows) with ordinality t(rw, n) where n > 1 and (rw ->> 1)::numeric < 0) then
    raise exception 'invalid_question: figure_not_numeric';
  end if;
  return jsonb_build_object('kind', v_kind,
    'captionAr', left(trim(coalesce(p ->> 'captionAr', '')), 300), 'captionEn', left(trim(coalesce(p ->> 'captionEn', '')), 300),
    'rows', v_rows);
end $$;

-- an ACTIVE hotspot question needs its image (the first image attachment)
create or replace function public.exam_bank_hotspot_ready(p_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public."ExamAsset" where "ownerType" = 'QUESTION' and "ownerId" = p_id and "kind" = 'IMAGE')
$$;

-- full question (public parts + secret) as JSON, for staff screens and version snapshots
create or replace function public.exam_bank_question_json(p_id text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id', q."id", 'programId', q."programId", 'type', q."type", 'status', q."status",
    'stemAr', q."stemAr", 'stemEn', q."stemEn", 'content', q."content",
    'points', q."points", 'weight', q."weight", 'difficulty', q."difficulty",
    'domainId', q."domainId", 'topicId', q."topicId", 'subtopicId', q."subtopicId",
    'keywords', to_jsonb(q."keywords"), 'reference', q."reference", 'version', q."version",
    'scenarioId', q."scenarioId", 'scenarioOrder', q."scenarioOrder",
    'createdAt', q."createdAt", 'updatedAt', q."updatedAt",
    'answer', s."answer", 'scoring', s."scoring",
    'feedbackAr', s."feedbackAr", 'feedbackEn', s."feedbackEn",
    'explanationAr', s."explanationAr", 'explanationEn', s."explanationEn",
    'optionRationale', s."optionRationale")
  from public."Question" q left join public."QuestionSecret" s on s."questionId" = q."id"
  where q."id" = p_id
$$;

-- ── browser-callable functions (staff of the course only) ──

-- Bank home: categories, counts and the caller's effective permissions for this course
create or replace function public.exam_bank_overview(p_program text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.exam_is_course_staff(p_program) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'categories', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', c."id", 'parentId', c."parentId", 'kind', c."kind", 'nameAr', c."nameAr", 'nameEn', c."nameEn",
        'sortOrder', c."sortOrder", 'active', c."active",
        'questions', (select count(*) from public."Question" q where q."domainId" = c."id" or q."topicId" = c."id" or q."subtopicId" = c."id"))
        order by c."sortOrder", c."nameAr"), '[]'::jsonb)
      from public."QuestionCategory" c where c."programId" = p_program),
    'counts', jsonb_build_object(
      'total', (select count(*) from public."Question" where "programId" = p_program),
      'scenarios', (select count(*) from public."Scenario" where "programId" = p_program),
      'byStatus', (select coalesce(jsonb_object_agg("status", n), '{}'::jsonb) from (select "status", count(*) n from public."Question" where "programId" = p_program group by 1) x),
      'byType', (select coalesce(jsonb_object_agg("type", n), '{}'::jsonb) from (select "type", count(*) n from public."Question" where "programId" = p_program group by 1) x)),
    'can', jsonb_build_object(
      'edit', public.exam_instructor_can(p_program, 'canEditQuestions'),
      'delete', public.exam_instructor_can(p_program, 'canDeleteQuestions'),
      'categories', public.exam_instructor_can(p_program, 'canManageCategories'),
      'scenarios', public.exam_instructor_can(p_program, 'canManageScenarios')));
end $$;

-- Create or rename a category. Hierarchy: DOMAIN → TOPIC → SUBTOPIC, all inside the same course.
create or replace function public.exam_bank_category_save(p_program text, p_cat jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me public."ExamMember" := public.exam_require_perm(p_program, 'canManageCategories');
  v_id text := nullif(p_cat ->> 'id', '');
  v_kind text := p_cat ->> 'kind';
  v_parent text := nullif(p_cat ->> 'parentId', '');
  v_ar text := trim(coalesce(p_cat ->> 'nameAr', ''));
  v_en text := trim(coalesce(p_cat ->> 'nameEn', ''));
  par public."QuestionCategory"; cur public."QuestionCategory"; res public."QuestionCategory";
begin
  if v_ar = '' and v_en = '' then raise exception 'invalid_category: name_missing'; end if;
  if char_length(v_ar) > 200 or char_length(v_en) > 200 then raise exception 'invalid_category: name_too_long'; end if;

  if v_id is not null then
    select * into cur from public."QuestionCategory" where "id" = v_id and "programId" = p_program;
    if cur."id" is null then raise exception 'not_found' using errcode = 'P0002'; end if;
    update public."QuestionCategory" set "nameAr" = v_ar, "nameEn" = v_en,
      "sortOrder" = coalesce((p_cat ->> 'sortOrder')::int, "sortOrder"),
      "active" = coalesce((p_cat ->> 'active')::boolean, "active"), "updatedAt" = now()
    where "id" = v_id returning * into res;
  else
    if v_kind not in ('DOMAIN', 'TOPIC', 'SUBTOPIC') then raise exception 'invalid_category: kind'; end if;
    if v_kind = 'DOMAIN' and v_parent is not null then raise exception 'invalid_category: domain_has_no_parent'; end if;
    if v_kind <> 'DOMAIN' then
      select * into par from public."QuestionCategory" where "id" = v_parent and "programId" = p_program;
      if par."id" is null then raise exception 'invalid_category: parent_missing'; end if;
      if (v_kind = 'TOPIC' and par."kind" <> 'DOMAIN') or (v_kind = 'SUBTOPIC' and par."kind" <> 'TOPIC') then
        raise exception 'invalid_category: wrong_parent';
      end if;
    end if;
    insert into public."QuestionCategory" ("programId", "parentId", "kind", "nameAr", "nameEn", "sortOrder", "createdById")
    values (p_program, v_parent, v_kind, v_ar, v_en, coalesce((p_cat ->> 'sortOrder')::int, 0), me."id")
    returning * into res;
  end if;
  perform public.exam_log(case when v_id is null then 'category.create' else 'category.update' end, 'QuestionCategory', res."id", p_program, null);
  return to_jsonb(res);
end $$;

create or replace function public.exam_bank_category_delete(p_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare cat public."QuestionCategory";
begin
  select * into cat from public."QuestionCategory" where "id" = p_id;
  if cat."id" is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  perform public.exam_require_perm(cat."programId", 'canManageCategories');
  if exists (select 1 from public."QuestionCategory" where "parentId" = p_id)
     or exists (select 1 from public."Question" where "domainId" = p_id or "topicId" = p_id or "subtopicId" = p_id) then
    raise exception 'category_in_use' using errcode = '23503';
  end if;
  delete from public."QuestionCategory" where "id" = p_id;
  perform public.exam_log('category.delete', 'QuestionCategory', p_id, cat."programId", jsonb_build_object('nameAr', cat."nameAr"));
  return jsonb_build_object('deleted', p_id);
end $$;

-- Search / filter / page through a course bank (summaries only — the answer stays in the editor view)
create or replace function public.exam_bank_questions(p_program text, p_filter jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  f jsonb := coalesce(p_filter, '{}'::jsonb);
  v_q text := nullif(trim(f ->> 'q'), '');
  v_page int := greatest(coalesce((f ->> 'page')::int, 1), 1);
  v_size int := least(greatest(coalesce((f ->> 'pageSize')::int, 25), 1), 100);
  v_cat text := nullif(f ->> 'categoryId', '');
begin
  perform public.exam_rate_hit('bank_list', 240);
  if not public.exam_is_course_staff(p_program) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return (
    with m as (
      select q.* from public."Question" q
      where q."programId" = p_program
        and (nullif(f ->> 'type', '') is null or q."type" = f ->> 'type')
        and (nullif(f ->> 'status', '') is null or q."status" = f ->> 'status')
        and (nullif(f ->> 'difficulty', '') is null or q."difficulty" = f ->> 'difficulty')
        and (v_cat is null or v_cat in (q."domainId", q."topicId", q."subtopicId"))
        and (nullif(f ->> 'scenarioId', '') is null
             or (f ->> 'scenarioId' = 'none' and q."scenarioId" is null)
             or q."scenarioId" = f ->> 'scenarioId')
        and (v_q is null or q."stemAr" ilike '%' || v_q || '%' or q."stemEn" ilike '%' || v_q || '%'
             or exists (select 1 from unnest(q."keywords") kw where kw ilike '%' || v_q || '%'))
    )
    select jsonb_build_object(
      'total', (select count(*) from m),
      'page', v_page, 'pageSize', v_size,
      'items', coalesce((select jsonb_agg(jsonb_build_object(
          'id', x."id", 'type', x."type", 'status', x."status",
          'stemAr', left(x."stemAr", 220), 'stemEn', left(x."stemEn", 220),
          'difficulty', x."difficulty", 'points', x."points", 'weight', x."weight",
          'domainId', x."domainId", 'topicId', x."topicId", 'subtopicId', x."subtopicId",
          'version', x."version", 'updatedAt', x."updatedAt", 'scenarioId', x."scenarioId") order by x."updatedAt" desc)
        from (select * from m order by "updatedAt" desc offset (v_page - 1) * v_size limit v_size) x), '[]'::jsonb))
  );
end $$;

-- One question with its answer, feedback and explanation (staff editor / preview)
create or replace function public.exam_bank_question(p_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_program text;
begin
  perform public.exam_rate_hit('bank_question', 240);
  select "programId" into v_program from public."Question" where "id" = p_id;
  if v_program is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  if not public.exam_is_course_staff(v_program) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return public.exam_bank_question_json(p_id);
end $$;

-- Create or update a question (validated per type; every save bumps the version and snapshots it)
create or replace function public.exam_bank_question_save(p_program text, p_q jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me public."ExamMember" := public.exam_require_perm(p_program, 'canEditQuestions');
  v_id text := nullif(p_q ->> 'id', '');
  v_type text := p_q ->> 'type';
  v_status text := coalesce(nullif(p_q ->> 'status', ''), 'DRAFT');
  v_diff text := coalesce(nullif(p_q ->> 'difficulty', ''), 'MEDIUM');
  v_ar text := trim(coalesce(p_q ->> 'stemAr', ''));
  v_en text := trim(coalesce(p_q ->> 'stemEn', ''));
  v_points numeric; v_weight numeric;
  v_dom text := nullif(p_q ->> 'domainId', '');
  v_top text := nullif(p_q ->> 'topicId', '');
  v_sub text := nullif(p_q ->> 'subtopicId', '');
  v_kw text[]; norm jsonb; cat public."QuestionCategory"; cur public."Question"; v_version int;
  v_scn text := nullif(p_q ->> 'scenarioId', ''); v_scn_order int; v_fig jsonb;
begin
  -- common fields
  if v_ar = '' and v_en = '' then raise exception 'invalid_question: stem_missing'; end if;
  if char_length(v_ar) > 10000 or char_length(v_en) > 10000 then raise exception 'invalid_question: stem_too_long'; end if;
  if v_status not in ('DRAFT', 'ACTIVE', 'DISABLED') then raise exception 'invalid_question: status'; end if;
  if v_diff not in ('EASY', 'MEDIUM', 'HARD') then raise exception 'invalid_question: difficulty'; end if;
  if coalesce(p_q ->> 'points', '1') !~ '^\d{1,4}(\.\d{1,2})?$' then raise exception 'invalid_question: points'; end if;
  if coalesce(p_q ->> 'weight', '1') !~ '^\d{1,3}(\.\d{1,2})?$' then raise exception 'invalid_question: weight'; end if;
  v_points := coalesce(p_q ->> 'points', '1')::numeric;
  v_weight := coalesce(p_q ->> 'weight', '1')::numeric;
  if v_points <= 0 or v_weight <= 0 then raise exception 'invalid_question: points'; end if;
  select coalesce(array_agg(distinct left(trim(x), 60)) filter (where trim(x) <> ''), '{}') into v_kw
    from jsonb_array_elements_text(coalesce(p_q -> 'keywords', '[]'::jsonb)) x;
  if cardinality(v_kw) > 20 then raise exception 'invalid_question: keywords_max_20'; end if;

  -- categories: must belong to this course; the deepest one chosen fills in its parents
  if v_sub is not null then
    select * into cat from public."QuestionCategory" where "id" = v_sub and "programId" = p_program and "kind" = 'SUBTOPIC';
    if cat."id" is null then raise exception 'invalid_question: subtopic'; end if;
    v_top := cat."parentId";
  end if;
  if v_top is not null then
    select * into cat from public."QuestionCategory" where "id" = v_top and "programId" = p_program and "kind" = 'TOPIC';
    if cat."id" is null then raise exception 'invalid_question: topic'; end if;
    v_dom := cat."parentId";
  end if;
  if v_dom is not null and not exists (select 1 from public."QuestionCategory" where "id" = v_dom and "programId" = p_program and "kind" = 'DOMAIN') then
    raise exception 'invalid_question: domain';
  end if;

  -- multi-question scenario (phase 4): must be a scenario of this course; new links go to the end
  if v_scn is not null and not exists (select 1 from public."Scenario" where "id" = v_scn and "programId" = p_program) then
    raise exception 'invalid_question: scenario';
  end if;

  norm := public.exam_bank_validate(v_type, p_q -> 'content', p_q -> 'answer', p_q -> 'scoring');
  -- phase 10: optional table / chart for any type
  v_fig := public.exam_bank_figure(p_q -> 'content' -> 'figure');
  if v_fig is not null then norm := jsonb_set(norm, '{content}', coalesce(norm -> 'content', '{}'::jsonb) || jsonb_build_object('figure', v_fig)); end if;

  if v_id is null then
    v_scn_order := case when v_scn is null then 0 else (select coalesce(max("scenarioOrder"), 0) + 1 from public."Question" where "scenarioId" = v_scn) end;
    insert into public."Question" ("programId", "type", "status", "stemAr", "stemEn", "content", "points", "weight", "difficulty",
      "domainId", "topicId", "subtopicId", "keywords", "reference", "scenarioId", "scenarioOrder", "createdById", "updatedById")
    values (p_program, v_type, v_status, v_ar, v_en, norm -> 'content', v_points, v_weight, v_diff,
      v_dom, v_top, v_sub, v_kw, left(trim(coalesce(p_q ->> 'reference', '')), 1000), v_scn, v_scn_order, me."id", me."id")
    returning "id", "version" into v_id, v_version;
  else
    select * into cur from public."Question" where "id" = v_id;
    if cur."id" is null or cur."programId" <> p_program then raise exception 'not_found' using errcode = 'P0002'; end if;
    v_scn_order := case when v_scn is null then 0
                        when v_scn is not distinct from cur."scenarioId" then cur."scenarioOrder"
                        else (select coalesce(max("scenarioOrder"), 0) + 1 from public."Question" where "scenarioId" = v_scn) end;
    update public."Question" set "scenarioId" = v_scn, "scenarioOrder" = v_scn_order, "type" = v_type, "status" = v_status, "stemAr" = v_ar, "stemEn" = v_en, "content" = norm -> 'content',
      "points" = v_points, "weight" = v_weight, "difficulty" = v_diff, "domainId" = v_dom, "topicId" = v_top, "subtopicId" = v_sub,
      "keywords" = v_kw, "reference" = left(trim(coalesce(p_q ->> 'reference', '')), 1000),
      "version" = cur."version" + 1, "updatedById" = me."id", "updatedAt" = now()
    where "id" = v_id returning "version" into v_version;
  end if;

  insert into public."QuestionSecret" ("questionId", "answer", "scoring", "feedbackAr", "feedbackEn", "explanationAr", "explanationEn", "optionRationale")
  values (v_id, norm -> 'answer', norm -> 'scoring',
    left(coalesce(p_q ->> 'feedbackAr', ''), 5000), left(coalesce(p_q ->> 'feedbackEn', ''), 5000),
    left(coalesce(p_q ->> 'explanationAr', ''), 10000), left(coalesce(p_q ->> 'explanationEn', ''), 10000),
    case when jsonb_typeof(p_q -> 'optionRationale') = 'object' then p_q -> 'optionRationale' else '{}'::jsonb end)
  on conflict ("questionId") do update set
    "answer" = excluded."answer", "scoring" = excluded."scoring",
    "feedbackAr" = excluded."feedbackAr", "feedbackEn" = excluded."feedbackEn",
    "explanationAr" = excluded."explanationAr", "explanationEn" = excluded."explanationEn",
    "optionRationale" = excluded."optionRationale", "updatedAt" = now();

  -- phase 10: a hotspot can only go ACTIVE once its image is attached (save it as a draft first)
  if v_type = 'HOTSPOT' and v_status = 'ACTIVE' and not public.exam_bank_hotspot_ready(v_id) then
    raise exception 'invalid_question: hotspot_image_missing';
  end if;

  insert into public."QuestionVersion" ("questionId", "version", "snapshot", "createdById")
  values (v_id, v_version, public.exam_bank_question_json(v_id), me."id");

  perform public.exam_log(case when v_version = 1 then 'question.create' else 'question.update' end, 'Question', v_id, p_program, jsonb_build_object('version', v_version, 'type', v_type));
  return public.exam_bank_question_json(v_id);
end $$;

-- Duplicate a question inside its own course bank (as a new draft)
create or replace function public.exam_bank_question_copy(p_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare src jsonb; v_program text;
begin
  select "programId" into v_program from public."Question" where "id" = p_id;
  if v_program is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  perform public.exam_require_perm(v_program, 'canEditQuestions');
  src := public.exam_bank_question_json(p_id);
  return public.exam_bank_question_save(v_program, (src - 'id' - 'version') || jsonb_build_object('status', 'DRAFT'));
end $$;

create or replace function public.exam_bank_question_set_status(p_id text, p_status text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_program text; me public."ExamMember";
begin
  if p_status not in ('DRAFT', 'ACTIVE', 'DISABLED') then raise exception 'invalid_question: status'; end if;
  select "programId" into v_program from public."Question" where "id" = p_id;
  if v_program is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  me := public.exam_require_perm(v_program, 'canEditQuestions');
  if p_status = 'ACTIVE' and (select "type" from public."Question" where "id" = p_id) = 'HOTSPOT' and not public.exam_bank_hotspot_ready(p_id) then
    raise exception 'invalid_question: hotspot_image_missing';
  end if;
  update public."Question" set "status" = p_status, "updatedById" = me."id", "updatedAt" = now() where "id" = p_id;
  perform public.exam_log('question.status', 'Question', p_id, v_program, jsonb_build_object('status', p_status));
  return jsonb_build_object('id', p_id, 'status', p_status);
end $$;

-- Delete policy: needs canDeleteQuestions. (Phase 6 adds: a question already used in an attempt
-- cannot be deleted — it must be disabled instead — so past results stay intact.)
create or replace function public.exam_bank_question_delete(p_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare q public."Question"; v_paths jsonb;
begin
  select * into q from public."Question" where "id" = p_id;
  if q."id" is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  perform public.exam_require_perm(q."programId", 'canDeleteQuestions');
  -- phase 5: a question picked into an exam cannot be deleted (remove it from the exam, or disable it)
  if exists (select 1 from public."ExamItem" where "questionId" = p_id) then
    raise exception 'question_in_exam' using errcode = '23503';
  end if;
  -- phase 6: answered in an attempt → keep it (disable instead) so past results stay intact
  if exists (select 1 from public."AttemptQuestion" where "questionId" = p_id) then
    raise exception 'question_in_attempt' using errcode = '23503';
  end if;
  select coalesce(jsonb_agg("path"), '[]'::jsonb) into v_paths from public."ExamAsset" where "ownerType" = 'QUESTION' and "ownerId" = p_id;
  delete from public."ExamAsset" where "ownerType" = 'QUESTION' and "ownerId" = p_id;
  delete from public."Question" where "id" = p_id;
  perform public.exam_log('question.delete', 'Question', p_id, q."programId", jsonb_build_object('type', q."type", 'stemAr', left(q."stemAr", 120)));
  -- the browser removes the attachment files from Storage
  return jsonb_build_object('deleted', p_id, 'paths', v_paths);
end $$;

-- ── access ──
do $$
declare t text;
begin
  foreach t in array array['QuestionCategory', 'Question', 'QuestionSecret', 'QuestionVersion'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;

revoke all on function public.exam_is_course_staff(text) from public, anon, authenticated;
revoke all on function public.exam_require_perm(text, text) from public, anon, authenticated;
revoke all on function public.exam_bank_list(jsonb, int, text) from public, anon, authenticated;
revoke all on function public.exam_bank_validate(text, jsonb, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.exam_bank_figure(jsonb) from public, anon, authenticated;
revoke all on function public.exam_bank_hotspot_ready(text) from public, anon, authenticated;
revoke all on function public.exam_bank_question_json(text) from public, anon, authenticated;

revoke all on function public.exam_bank_overview(text) from public, anon;
revoke all on function public.exam_bank_category_save(text, jsonb) from public, anon;
revoke all on function public.exam_bank_category_delete(text) from public, anon;
revoke all on function public.exam_bank_questions(text, jsonb) from public, anon;
revoke all on function public.exam_bank_question(text) from public, anon;
revoke all on function public.exam_bank_question_save(text, jsonb) from public, anon;
revoke all on function public.exam_bank_question_copy(text) from public, anon;
revoke all on function public.exam_bank_question_set_status(text, text) from public, anon;
revoke all on function public.exam_bank_question_delete(text) from public, anon;

grant execute on function public.exam_bank_overview(text) to authenticated;
grant execute on function public.exam_bank_category_save(text, jsonb) to authenticated;
grant execute on function public.exam_bank_category_delete(text) to authenticated;
grant execute on function public.exam_bank_questions(text, jsonb) to authenticated;
grant execute on function public.exam_bank_question(text) to authenticated;
grant execute on function public.exam_bank_question_save(text, jsonb) to authenticated;
grant execute on function public.exam_bank_question_copy(text) to authenticated;
grant execute on function public.exam_bank_question_set_status(text, text) to authenticated;
grant execute on function public.exam_bank_question_delete(text) to authenticated;
