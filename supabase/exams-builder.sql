-- ─────────────────────────────────────────────────────────────────────────────
-- Exam system · Phase 5 — exam builder.
-- Applied by `npm run supabase:setup` after exams-scenarios.sql (safe to run again).
--
--   • Creating / editing an exam needs canCreateExams AND the folder permission
--     (Domain Tests → canManageDomainTests, Exam Simulations → canManageSimulations). Admins can do all.
--   • Publishing: admins and instructors with canPublishExams publish directly; other instructors send the
--     exam for approval (status PENDING_APPROVAL + a notification in the admin dashboard).
--   • An exam can only be published when exam_exam_check() finds no problem (questions exist, are active,
--     belong to the course, random rules have enough questions, dates make sense).
--   • Published / pending exams are locked: stop them (or have them returned to draft) before editing.
--   • Learners only ever see published exams of courses they are enrolled in, without any question data.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── helpers ──

create or replace function public.exam_folder_perm(p_kind text)
returns text
language sql
immutable
as $$
  select case p_kind when 'DOMAIN_TESTS' then 'canManageDomainTests' when 'EXAM_SIMULATIONS' then 'canManageSimulations' end
$$;

-- caller may create/edit exams in this folder
create or replace function public.exam_can_edit_exams(p_folder text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare f public."ExamFolder";
begin
  select * into f from public."ExamFolder" where "id" = p_folder;
  if f."id" is null then return false; end if;
  return coalesce(public.exam_instructor_can(f."programId", 'canCreateExams')
    and (public.exam_folder_perm(f."kind") is null or public.exam_instructor_can(f."programId", public.exam_folder_perm(f."kind"))), false);
end $$;

create or replace function public.exam_require_exam_editor(p_folder text)
returns public."ExamMember"
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.exam_can_edit_exams(p_folder) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return public.exam_current_member();
end $$;

-- active standalone questions a random rule may draw from (excluding the exam's hand-picked questions)
create or replace function public.exam_rule_pool(p_rule public."ExamRule", p_program text)
returns setof text
language sql
stable
security definer
set search_path = public
as $$
  select q."id" from public."Question" q
  where q."programId" = p_program and q."status" = 'ACTIVE' and q."scenarioId" is null
    and (p_rule."domainId" is null or q."domainId" = p_rule."domainId")
    and (p_rule."topicId" is null or q."topicId" = p_rule."topicId")
    and (p_rule."subtopicId" is null or q."subtopicId" = p_rule."subtopicId")
    and (p_rule."difficulty" is null or q."difficulty" = p_rule."difficulty")
    and (p_rule."qtype" is null or q."type" = p_rule."qtype")
    and not exists (select 1 from public."ExamItem" i where i."examId" = p_rule."examId" and i."questionId" = q."id")
$$;

-- active scenarios (with at least one active question) a scenario rule may draw from
create or replace function public.exam_rule_scenarios(p_rule public."ExamRule", p_program text)
returns setof text
language sql
stable
security definer
set search_path = public
as $$
  select s."id" from public."Scenario" s
  where s."programId" = p_program and s."status" = 'ACTIVE'
    and exists (select 1 from public."Question" q where q."scenarioId" = s."id" and q."status" = 'ACTIVE'
                  and (p_rule."domainId" is null or q."domainId" = p_rule."domainId")
                  and (p_rule."difficulty" is null or q."difficulty" = p_rule."difficulty"))
    and not exists (select 1 from public."ExamItem" i join public."Question" q2 on q2."id" = i."questionId"
                    where i."examId" = p_rule."examId" and q2."scenarioId" = s."id")
$$;

-- readiness report: {ok, issues[], rules[{position, count, available}], questionCount, fixedPoints, variablePoints}
create or replace function public.exam_exam_check_json(p_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  e public."Exam"; r public."ExamRule";
  v_issues jsonb := '[]'::jsonb; v_rules jsonb := '[]'::jsonb;
  v_avail int; v_count int := 0; v_points numeric := 0; v_variable boolean := false;
  v_items int; v_bad int; v_standalone_need int := 0; v_union int;
begin
  select * into e from public."Exam" where "id" = p_id;
  if e."id" is null then return null; end if;

  select count(*) into v_items from public."ExamItem" where "examId" = p_id;
  select count(*) into v_bad from public."ExamItem" i left join public."Question" q on q."id" = i."questionId"
    where i."examId" = p_id and (q."id" is null or q."status" <> 'ACTIVE' or q."programId" <> e."programId");
  if v_bad > 0 then v_issues := v_issues || jsonb_build_object('code', 'items_inactive', 'n', v_bad); end if;
  v_count := v_items;
  select coalesce(sum(coalesce(i."points", q."points") * coalesce(i."weight", q."weight")), 0) into v_points
    from public."ExamItem" i join public."Question" q on q."id" = i."questionId" where i."examId" = p_id;

  for r in select * from public."ExamRule" where "examId" = p_id order by "position" loop
    if r."scenarios" then
      select count(*) into v_avail from public.exam_rule_scenarios(r, e."programId");
      v_variable := true; -- scenarios have different numbers of questions
      v_count := v_count + (select coalesce(sum(n), 0) from (
        select count(*) n from public."Question" q where q."scenarioId" in (select public.exam_rule_scenarios(r, e."programId")) and q."status" = 'ACTIVE'
        group by q."scenarioId" order by n limit r."count") x); -- smallest possible
    else
      select count(*) into v_avail from public.exam_rule_pool(r, e."programId");
      v_count := v_count + r."count";
      v_standalone_need := v_standalone_need + r."count";
      if r."points" is null or r."weight" is null then v_variable := true;
      else v_points := v_points + r."count" * r."points" * r."weight"; end if;
    end if;
    v_rules := v_rules || jsonb_build_object('position', r."position", 'count', r."count", 'available', v_avail, 'scenarios', r."scenarios");
    if v_avail < r."count" then
      v_issues := v_issues || jsonb_build_object('code', 'rule_short', 'position', r."position", 'need', r."count", 'available', v_avail);
    end if;
  end loop;

  -- rules may overlap: the union of their pools must cover all standalone draws
  if v_standalone_need > 0 then
    select count(distinct id) into v_union from (
      select public.exam_rule_pool(x, e."programId") id from public."ExamRule" x where x."examId" = p_id and not x."scenarios") u;
    if v_union < v_standalone_need then
      v_issues := v_issues || jsonb_build_object('code', 'pool_overlap', 'need', v_standalone_need, 'available', v_union);
    end if;
  end if;

  if v_count = 0 then v_issues := v_issues || jsonb_build_object('code', 'no_questions'); end if;
  if v_count > 500 then v_issues := v_issues || jsonb_build_object('code', 'too_many_questions'); end if;
  if e."startsAt" is not null and e."endsAt" is not null and e."endsAt" <= e."startsAt" then
    v_issues := v_issues || jsonb_build_object('code', 'dates');
  end if;
  if e."endsAt" is not null and e."endsAt" < now() then v_issues := v_issues || jsonb_build_object('code', 'ended'); end if;

  return jsonb_build_object('ok', jsonb_array_length(v_issues) = 0, 'issues', v_issues, 'rules', v_rules,
    'questionCount', v_count, 'fixedPoints', v_points, 'variablePoints', v_variable);
end $$;

create or replace function public.exam_exam_json(p_id text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select to_jsonb(e) - 'createdById' - 'updatedById' - 'approvedById'
    || jsonb_build_object(
      'folderKind', (select "kind" from public."ExamFolder" where "id" = e."folderId"),
      'items', (select coalesce(jsonb_agg(jsonb_build_object(
          'questionId', i."questionId", 'position', i."position", 'points', i."points", 'weight', i."weight",
          'type', q."type", 'status', q."status", 'stemAr', left(q."stemAr", 200), 'stemEn', left(q."stemEn", 200),
          'qPoints', q."points", 'qWeight', q."weight", 'scenarioId', q."scenarioId") order by i."position"), '[]'::jsonb)
        from public."ExamItem" i join public."Question" q on q."id" = i."questionId" where i."examId" = e."id"),
      'rules', (select coalesce(jsonb_agg(to_jsonb(r) - 'examId' - 'id' order by r."position"), '[]'::jsonb)
        from public."ExamRule" r where r."examId" = e."id"))
  from public."Exam" e where e."id" = p_id
$$;

-- ── browser-callable ──

-- Exams of one folder. Staff: everything (with readiness). Learners: published exams of their course only.
create or replace function public.exam_folder_exams(p_folder text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare f public."ExamFolder"; v_access text;
begin
  select * into f from public."ExamFolder" where "id" = p_folder;
  if f."id" is null or f."kind" not in ('DOMAIN_TESTS', 'EXAM_SIMULATIONS', 'CUSTOM') then raise exception 'not_found' using errcode = 'P0002'; end if;
  v_access := public.exam_course_access(f."programId");
  if v_access is null or (v_access = 'LEARNER' and f."status" <> 'ACTIVE') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'folder', jsonb_build_object('id', f."id", 'kind', f."kind", 'nameAr', f."nameAr", 'nameEn', f."nameEn", 'programId', f."programId"),
    'canEdit', public.exam_can_edit_exams(p_folder),
    'canApprove', v_access = 'ADMIN',
    'exams', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', e."id", 'titleAr', e."titleAr", 'titleEn', e."titleEn", 'descAr', e."descAr", 'descEn', e."descEn",
        'examType', e."examType", 'status', e."status", 'durationMinutes', e."durationMinutes", 'maxAttempts', e."maxAttempts",
        'startsAt', e."startsAt", 'endsAt', e."endsAt", 'passPercent', e."passPercent", 'updatedAt', e."updatedAt",
        'questionCount', (public.exam_exam_check_json(e."id") ->> 'questionCount')::int)
        order by e."createdAt" desc), '[]'::jsonb)
      from public."Exam" e
      where e."folderId" = p_folder
        and (v_access in ('ADMIN', 'INSTRUCTOR') or e."status" = 'PUBLISHED')));
end $$;

create or replace function public.exam_exam_get(p_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare e public."Exam";
begin
  select * into e from public."Exam" where "id" = p_id;
  if e."id" is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  if not public.exam_is_course_staff(e."programId") then raise exception 'forbidden' using errcode = '42501'; end if;
  return public.exam_exam_json(p_id) || jsonb_build_object(
    'check', public.exam_exam_check_json(p_id),
    'canEdit', public.exam_can_edit_exams(e."folderId"),
    'canPublish', public.exam_instructor_can(e."programId", 'canPublishExams'),
    'canApprove', public.exam_course_access(e."programId") = 'ADMIN');
end $$;

-- Create / update a draft exam with its hand-picked questions and random rules (replaced as a whole)
create or replace function public.exam_exam_save(p_e jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id text := nullif(p_e ->> 'id', '');
  v_folder text := p_e ->> 'folderId';
  f public."ExamFolder"; cur public."Exam"; me public."ExamMember";
  v_ar text := trim(coalesce(p_e ->> 'titleAr', ''));
  v_en text := trim(coalesce(p_e ->> 'titleEn', ''));
  sec jsonb := coalesce(p_e -> 'security', '{}'::jsonb);
  v_sec jsonb; it jsonb; ru jsonb; i int := 0; v_q public."Question"; k text;
  v_dur int := nullif(p_e ->> 'durationMinutes', '')::int;
  v_att int := nullif(p_e ->> 'maxAttempts', '')::int;
  v_grace int := coalesce(nullif(p_e ->> 'graceSeconds', '')::int, 0);
  v_pass numeric := coalesce(nullif(p_e ->> 'passPercent', '')::numeric, 70);
  v_start timestamptz := nullif(p_e ->> 'startsAt', '')::timestamptz;
  v_end timestamptz := nullif(p_e ->> 'endsAt', '')::timestamptz;
  v_n int;
begin
  if v_id is not null then
    select * into cur from public."Exam" where "id" = v_id;
    if cur."id" is null then raise exception 'not_found' using errcode = 'P0002'; end if;
    v_folder := coalesce(v_folder, cur."folderId");
  end if;
  select * into f from public."ExamFolder" where "id" = v_folder;
  if f."id" is null or f."kind" not in ('DOMAIN_TESTS', 'EXAM_SIMULATIONS', 'CUSTOM') then raise exception 'invalid_exam: folder'; end if;
  if cur."id" is not null and cur."programId" <> f."programId" then raise exception 'invalid_exam: folder'; end if;
  me := public.exam_require_exam_editor(v_folder);
  if cur."id" is not null and not public.exam_can_edit_exams(cur."folderId") then raise exception 'forbidden' using errcode = '42501'; end if;
  if cur."status" in ('PUBLISHED', 'STOPPED', 'ARCHIVED') then raise exception 'exam_locked' using errcode = '42501'; end if;

  -- settings
  if v_ar = '' and v_en = '' then raise exception 'invalid_exam: title_missing'; end if;
  if char_length(v_ar) > 300 or char_length(v_en) > 300 then raise exception 'invalid_exam: title_too_long'; end if;
  if coalesce(p_e ->> 'examType', 'PRACTICE') not in ('PRACTICE', 'SIMULATION', 'FINAL') then raise exception 'invalid_exam: type'; end if;
  if v_dur is not null and (v_dur < 1 or v_dur > 600) then raise exception 'invalid_exam: duration'; end if;
  if v_grace < 0 or v_grace > 600 then raise exception 'invalid_exam: grace'; end if;
  if v_att is not null and (v_att < 1 or v_att > 100) then raise exception 'invalid_exam: attempts'; end if;
  if v_pass < 0 or v_pass > 100 then raise exception 'invalid_exam: pass_percent'; end if;
  if v_start is not null and v_end is not null and v_end <= v_start then raise exception 'invalid_exam: dates'; end if;
  if coalesce(p_e ->> 'reviewPolicy', 'AFTER_SUBMIT') not in ('NEVER', 'AFTER_SUBMIT', 'AFTER_CLOSE') then raise exception 'invalid_exam: review_policy'; end if;
  if coalesce(p_e ->> 'resultsPolicy', 'IMMEDIATE') not in ('IMMEDIATE', 'AFTER_CLOSE', 'MANUAL') then raise exception 'invalid_exam: results_policy'; end if;
  if coalesce(p_e ->> 'resumePolicy', 'RESUME') not in ('RESUME', 'NO_RESUME') then raise exception 'invalid_exam: resume_policy'; end if;
  if coalesce(sec ->> 'onExceed', 'WARN') not in ('WARN', 'SUBMIT', 'REVIEW') then raise exception 'invalid_exam: security'; end if;
  v_sec := jsonb_build_object(
    'fullscreen', coalesce((sec ->> 'fullscreen')::boolean, false),
    'detectBlur', coalesce((sec ->> 'detectBlur')::boolean, true),
    'maxWarnings', least(greatest(coalesce((sec ->> 'maxWarnings')::int, 3), 0), 50),
    'onExceed', coalesce(sec ->> 'onExceed', 'WARN'),
    'watermark', coalesce((sec ->> 'watermark')::boolean, true),
    'blockCopy', coalesce((sec ->> 'blockCopy')::boolean, true));

  if v_id is null then
    insert into public."Exam" ("programId", "folderId", "titleAr", "titleEn", "createdById") values (f."programId", f."id", v_ar, v_en, me."id")
    returning "id" into v_id;
  end if;
  update public."Exam" set
    "folderId" = f."id", "titleAr" = v_ar, "titleEn" = v_en,
    "descAr" = left(coalesce(p_e ->> 'descAr', ''), 5000), "descEn" = left(coalesce(p_e ->> 'descEn', ''), 5000),
    "examType" = coalesce(p_e ->> 'examType', 'PRACTICE'), "durationMinutes" = v_dur, "graceSeconds" = v_grace,
    "startsAt" = v_start, "endsAt" = v_end, "maxAttempts" = v_att,
    "shuffleQuestions" = coalesce((p_e ->> 'shuffleQuestions')::boolean, true), "shuffleOptions" = coalesce((p_e ->> 'shuffleOptions')::boolean, true),
    "passPercent" = v_pass, "reviewPolicy" = coalesce(p_e ->> 'reviewPolicy', 'AFTER_SUBMIT'), "resultsPolicy" = coalesce(p_e ->> 'resultsPolicy', 'IMMEDIATE'),
    "showFeedback" = coalesce((p_e ->> 'showFeedback')::boolean, true), "showExplanation" = coalesce((p_e ->> 'showExplanation')::boolean, true),
    "showCorrect" = coalesce((p_e ->> 'showCorrect')::boolean, true),
    "allowCalculator" = coalesce((p_e ->> 'allowCalculator')::boolean, false), "allowWhiteboard" = coalesce((p_e ->> 'allowWhiteboard')::boolean, false),
    "allowTranslation" = coalesce((p_e ->> 'allowTranslation')::boolean, true), "resumePolicy" = coalesce(p_e ->> 'resumePolicy', 'RESUME'),
    "security" = v_sec, "status" = 'DRAFT', -- editing a pending exam sends it back to draft
    "version" = case when cur."id" is null then 1 else cur."version" + 1 end, "updatedById" = me."id", "updatedAt" = now()
  where "id" = v_id;

  -- hand-picked questions
  delete from public."ExamItem" where "examId" = v_id;
  if jsonb_array_length(coalesce(p_e -> 'items', '[]'::jsonb)) > 500 then raise exception 'invalid_exam: items_max_500'; end if;
  for it in select value from jsonb_array_elements(coalesce(p_e -> 'items', '[]'::jsonb)) loop
    i := i + 1;
    select * into v_q from public."Question" where "id" = it ->> 'questionId';
    if v_q."id" is null or v_q."programId" <> f."programId" then raise exception 'invalid_exam: item_question'; end if;
    if coalesce(it ->> 'points', '') !~ '^(\d{1,4}(\.\d{1,2})?)?$' or coalesce(it ->> 'weight', '') !~ '^(\d{1,3}(\.\d{1,2})?)?$' then raise exception 'invalid_exam: item_points'; end if;
    insert into public."ExamItem" ("examId", "questionId", "position", "points", "weight")
    values (v_id, v_q."id", i, nullif(it ->> 'points', '')::numeric, nullif(it ->> 'weight', '')::numeric)
    on conflict ("examId", "questionId") do nothing;
  end loop;

  -- random rules
  delete from public."ExamRule" where "examId" = v_id;
  if jsonb_array_length(coalesce(p_e -> 'rules', '[]'::jsonb)) > 50 then raise exception 'invalid_exam: rules_max_50'; end if;
  i := 0;
  for ru in select value from jsonb_array_elements(coalesce(p_e -> 'rules', '[]'::jsonb)) loop
    i := i + 1;
    v_n := nullif(ru ->> 'count', '')::int;
    if v_n is null or v_n < 1 or v_n > 500 then raise exception 'invalid_exam: rule_count'; end if;
    if coalesce(ru ->> 'difficulty', '') not in ('', 'EASY', 'MEDIUM', 'HARD') then raise exception 'invalid_exam: rule_difficulty'; end if;
    if coalesce(ru ->> 'qtype', '') not in ('', 'MCQ', 'MULTI', 'TRUE_FALSE', 'NUMERIC', 'SHORT', 'ESSAY', 'ORDERING', 'MATCHING') then raise exception 'invalid_exam: rule_type'; end if;
    foreach k in array array['DOMAIN', 'TOPIC', 'SUBTOPIC'] loop
      if nullif(ru ->> (lower(k) || 'Id'), '') is not null and not exists (
        select 1 from public."QuestionCategory" where "id" = ru ->> (lower(k) || 'Id') and "programId" = f."programId" and "kind" = k) then
        raise exception 'invalid_exam: rule_category';
      end if;
    end loop;
    if coalesce(ru ->> 'points', '') !~ '^(\d{1,4}(\.\d{1,2})?)?$' or coalesce(ru ->> 'weight', '') !~ '^(\d{1,3}(\.\d{1,2})?)?$' then raise exception 'invalid_exam: rule_points'; end if;
    insert into public."ExamRule" ("examId", "position", "count", "domainId", "topicId", "subtopicId", "difficulty", "qtype", "scenarios", "points", "weight")
    values (v_id, i, v_n, nullif(ru ->> 'domainId', ''), nullif(ru ->> 'topicId', ''), nullif(ru ->> 'subtopicId', ''),
      nullif(ru ->> 'difficulty', ''), nullif(ru ->> 'qtype', ''), coalesce((ru ->> 'scenarios')::boolean, false),
      nullif(ru ->> 'points', '')::numeric, nullif(ru ->> 'weight', '')::numeric);
  end loop;

  perform public.exam_log(case when cur."id" is null then 'exam.create' else 'exam.update' end, 'Exam', v_id, f."programId", null);
  return public.exam_exam_get(v_id);
end $$;

-- Publish (or send for approval)
create or replace function public.exam_exam_publish(p_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare e public."Exam"; me public."ExamMember"; v_check jsonb; v_status text;
begin
  select * into e from public."Exam" where "id" = p_id;
  if e."id" is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  me := public.exam_require_exam_editor(e."folderId");
  if e."status" not in ('DRAFT', 'STOPPED') then raise exception 'invalid_exam: status'; end if;
  v_check := public.exam_exam_check_json(p_id);
  if not (v_check ->> 'ok')::boolean then raise exception 'exam_not_ready' using errcode = '22023'; end if;
  if public.exam_instructor_can(e."programId", 'canPublishExams') then
    v_status := 'PUBLISHED';
    update public."Exam" set "status" = v_status, "publishedAt" = coalesce("publishedAt", now()), "reviewNote" = '', "updatedAt" = now() where "id" = p_id;
  else
    v_status := 'PENDING_APPROVAL';
    update public."Exam" set "status" = v_status, "updatedAt" = now() where "id" = p_id;
    insert into public."Notification" ("id", "type", "title", "body", "link")
    values (gen_random_uuid()::text, 'exam', 'اختبار بانتظار الاعتماد: ' || coalesce(nullif(e."titleAr", ''), e."titleEn"),
      'أرسل المدرب ' || me."email" || ' اختبارًا للاعتماد في منصة الاختبارات.', '/ar/exams/exam?id=' || p_id);
  end if;
  perform public.exam_log('exam.' || lower(v_status), 'Exam', p_id, e."programId", null);
  return public.exam_exam_get(p_id);
end $$;

-- Admin decision on a pending exam
create or replace function public.exam_exam_review(p_id text, p_approve boolean, p_note text default '')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare e public."Exam"; me public."ExamMember" := public.exam_require_admin();
begin
  select * into e from public."Exam" where "id" = p_id;
  if e."id" is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  if e."status" <> 'PENDING_APPROVAL' then raise exception 'invalid_exam: status'; end if;
  if p_approve then
    if not (public.exam_exam_check_json(p_id) ->> 'ok')::boolean then raise exception 'exam_not_ready' using errcode = '22023'; end if;
    update public."Exam" set "status" = 'PUBLISHED', "approvedById" = me."id", "approvedAt" = now(), "publishedAt" = coalesce("publishedAt", now()), "reviewNote" = '', "updatedAt" = now() where "id" = p_id;
  else
    update public."Exam" set "status" = 'DRAFT', "reviewNote" = left(coalesce(p_note, ''), 2000), "updatedAt" = now() where "id" = p_id;
  end if;
  perform public.exam_log(case when p_approve then 'exam.approve' else 'exam.return' end, 'Exam', p_id, e."programId", jsonb_build_object('note', p_note));
  return public.exam_exam_get(p_id);
end $$;

-- Stop / archive / back to draft (phase 6 adds: an exam with attempts cannot go back to draft or be deleted)
create or replace function public.exam_exam_set_status(p_id text, p_status text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare e public."Exam";
begin
  select * into e from public."Exam" where "id" = p_id;
  if e."id" is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  perform public.exam_require_exam_editor(e."folderId");
  -- phase 6: once learners have attempts, the exam can be stopped or archived but never edited again
  if p_status = 'DRAFT' and exists (select 1 from public."ExamAttempt" where "examId" = p_id) then
    raise exception 'exam_has_attempts' using errcode = '42501';
  end if;
  if not ((e."status" = 'PUBLISHED' and p_status = 'STOPPED')
       or (e."status" in ('STOPPED', 'PENDING_APPROVAL') and p_status = 'DRAFT')
       or (e."status" in ('STOPPED', 'DRAFT') and p_status = 'ARCHIVED')
       or (e."status" = 'ARCHIVED' and p_status = 'DRAFT')) then
    raise exception 'invalid_exam: status';
  end if;
  update public."Exam" set "status" = p_status, "updatedAt" = now() where "id" = p_id;
  perform public.exam_log('exam.status', 'Exam', p_id, e."programId", jsonb_build_object('from', e."status", 'to', p_status));
  return public.exam_exam_get(p_id);
end $$;

create or replace function public.exam_exam_delete(p_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare e public."Exam";
begin
  select * into e from public."Exam" where "id" = p_id;
  if e."id" is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  perform public.exam_require_exam_editor(e."folderId");
  if e."status" not in ('DRAFT', 'ARCHIVED') then raise exception 'exam_locked' using errcode = '42501'; end if;
  if exists (select 1 from public."ExamAttempt" where "examId" = p_id) then raise exception 'exam_has_attempts' using errcode = '42501'; end if;
  delete from public."Exam" where "id" = p_id;
  perform public.exam_log('exam.delete', 'Exam', p_id, e."programId", jsonb_build_object('titleAr', e."titleAr"));
  return jsonb_build_object('deleted', p_id);
end $$;

-- Staff preview: one sample draw, in exam order, with full question data (staff already see answers in the bank)
create or replace function public.exam_exam_preview(p_id text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare e public."Exam"; r public."ExamRule"; v_ids text[] := '{}'; v_draw text[]; v_out jsonb := '[]'::jsonb; qid text;
begin
  select * into e from public."Exam" where "id" = p_id;
  if e."id" is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  if not public.exam_is_course_staff(e."programId") then raise exception 'forbidden' using errcode = '42501'; end if;

  select coalesce(array_agg(i."questionId" order by i."position"), '{}') into v_ids
    from public."ExamItem" i join public."Question" q on q."id" = i."questionId" where i."examId" = p_id and q."status" = 'ACTIVE';
  for r in select * from public."ExamRule" where "examId" = p_id order by "position" loop
    if r."scenarios" then
      select coalesce(array_agg(q."id" order by s.rnd, q."scenarioOrder"), '{}') into v_draw
      from (select sid, random() rnd from public.exam_rule_scenarios(r, e."programId") sid order by random() limit r."count") s
      join public."Question" q on q."scenarioId" = s.sid and q."status" = 'ACTIVE';
    else
      select coalesce(array_agg(id), '{}') into v_draw
      from (select id from public.exam_rule_pool(r, e."programId") id where not id = any(v_ids) order by random() limit r."count") x;
    end if;
    v_ids := v_ids || v_draw;
  end loop;
  if cardinality(v_ids) > 300 then v_ids := v_ids[1:300]; end if;

  foreach qid in array v_ids loop
    v_out := v_out || jsonb_build_array(public.exam_bank_question_json(qid));
  end loop;
  return jsonb_build_object('questions', v_out, 'shuffled', e."shuffleQuestions");
end $$;

-- ── access ──
do $$
declare t text;
begin
  foreach t in array array['Exam', 'ExamItem', 'ExamRule'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;

revoke all on function public.exam_folder_perm(text) from public, anon, authenticated;
revoke all on function public.exam_can_edit_exams(text) from public, anon, authenticated;
revoke all on function public.exam_require_exam_editor(text) from public, anon, authenticated;
revoke all on function public.exam_rule_pool(public."ExamRule", text) from public, anon, authenticated;
revoke all on function public.exam_rule_scenarios(public."ExamRule", text) from public, anon, authenticated;
revoke all on function public.exam_exam_check_json(text) from public, anon, authenticated;
revoke all on function public.exam_exam_json(text) from public, anon, authenticated;

revoke all on function public.exam_folder_exams(text) from public, anon;
revoke all on function public.exam_exam_get(text) from public, anon;
revoke all on function public.exam_exam_save(jsonb) from public, anon;
revoke all on function public.exam_exam_publish(text) from public, anon;
revoke all on function public.exam_exam_review(text, boolean, text) from public, anon;
revoke all on function public.exam_exam_set_status(text, text) from public, anon;
revoke all on function public.exam_exam_delete(text) from public, anon;
revoke all on function public.exam_exam_preview(text) from public, anon;

grant execute on function public.exam_folder_exams(text) to authenticated;
grant execute on function public.exam_exam_get(text) to authenticated;
grant execute on function public.exam_exam_save(jsonb) to authenticated;
grant execute on function public.exam_exam_publish(text) to authenticated;
grant execute on function public.exam_exam_review(text, boolean, text) to authenticated;
grant execute on function public.exam_exam_set_status(text, text) to authenticated;
grant execute on function public.exam_exam_delete(text) to authenticated;
grant execute on function public.exam_exam_preview(text) to authenticated;
