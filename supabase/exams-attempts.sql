-- ─────────────────────────────────────────────────────────────────────────────
-- Exam system · Phase 6 — attempts, server-side timer, grading, results and review.
-- Applied by `npm run supabase:setup` after exams-builder.sql (safe to run again).
--
--   • Start: the questions are drawn once and frozen (question version + shuffled public view).
--   • The browser only ever receives "publicData" (no correct answer, feedback, explanation, rationale).
--   • Time is the server's: deadlineAt is fixed at start; any call after deadline + grace finalises the
--     attempt as TIMED_OUT and later saves are refused. The browser clock is never trusted.
--   • Grading happens here, from the frozen snapshot, never from anything the browser sends.
--   • Results and review are released only as the exam's policies allow.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── public view of one frozen question (what the learner may see) ──
create or replace function public.exam_public_question(p_snap jsonb, p_shuffle_options boolean, p_images jsonb)
returns jsonb
language plpgsql
volatile
set search_path = public
as $$
declare
  t text := p_snap ->> 'type';
  c jsonb := coalesce(p_snap -> 'content', '{}'::jsonb);
  v jsonb := jsonb_build_object('type', t, 'stemAr', p_snap ->> 'stemAr', 'stemEn', p_snap ->> 'stemEn', 'images', coalesce(p_images, '[]'::jsonb));
  items jsonb; tries int := 0;
begin
  if t in ('MCQ', 'MULTI') then
    v := v || jsonb_build_object('options', case when p_shuffle_options
      then (select jsonb_agg(o order by random()) from jsonb_array_elements(c -> 'options') o) else c -> 'options' end);
    if t = 'MULTI' then
      -- like professional exams: the learner is told how many to choose (not which)
      v := v || jsonb_build_object('selectCount', jsonb_array_length(p_snap -> 'answer' -> 'correct'));
    end if;
  elsif t = 'NUMERIC' then
    v := v || jsonb_build_object('unitAr', c ->> 'unitAr', 'unitEn', c ->> 'unitEn');
  elsif t = 'ESSAY' then
    v := v || jsonb_build_object('minWords', c -> 'minWords', 'maxWords', c -> 'maxWords');
  elsif t = 'ORDERING' then
    -- always shuffled, and never handed out already in the correct order
    loop
      select jsonb_agg(o order by random()) into items from jsonb_array_elements(c -> 'items') o;
      tries := tries + 1;
      exit when tries >= 6 or jsonb_array_length(items) < 2
        or (select array_agg(o ->> 'id') from jsonb_array_elements(items) o) is distinct from (select array_agg(x) from jsonb_array_elements_text(p_snap -> 'answer' -> 'order') x);
    end loop;
    v := v || jsonb_build_object('items', items);
  elsif t = 'MATCHING' then
    v := v || jsonb_build_object(
      'left', case when p_shuffle_options then (select jsonb_agg(o order by random()) from jsonb_array_elements(c -> 'left') o) else c -> 'left' end,
      'right', (select jsonb_agg(o order by random()) from jsonb_array_elements(c -> 'right') o));
  end if;
  return v;
end $$;

-- ── grading of one answer from the frozen snapshot. Returns {score, correct, manual} ──
create or replace function public.exam_grade(p_snap jsonb, p_response jsonb, p_max numeric)
returns jsonb
language plpgsql
immutable
set search_path = public
as $$
declare
  t text := p_snap ->> 'type';
  a jsonb := coalesce(p_snap -> 'answer', '{}'::jsonb);
  mode text := coalesce(p_snap -> 'scoring' ->> 'mode', 'ALL_OR_NOTHING');
  r jsonb := p_response;
  correct text[]; chosen text[]; hits int; wrongs int; n int; ok int; k text; txt text; acc text; v numeric;
begin
  if t = 'ESSAY' then
    return jsonb_build_object('score', null, 'correct', null, 'manual', true);
  end if;
  if r is null or r = 'null'::jsonb then
    return jsonb_build_object('score', 0, 'correct', false, 'manual', false);
  end if;

  if t = 'MCQ' then
    return case when (r ->> 'choice') = (a -> 'correct' ->> 0)
      then jsonb_build_object('score', p_max, 'correct', true, 'manual', false)
      else jsonb_build_object('score', 0, 'correct', false, 'manual', false) end;

  elsif t = 'MULTI' then
    select array_agg(x) into correct from jsonb_array_elements_text(a -> 'correct') x;
    select coalesce(array_agg(distinct x), '{}') into chosen from jsonb_array_elements_text(coalesce(r -> 'choices', '[]'::jsonb)) x;
    hits := (select count(*) from unnest(chosen) x where x = any(correct));
    wrongs := cardinality(chosen) - hits;
    n := cardinality(correct);
    if hits = n and wrongs = 0 then
      return jsonb_build_object('score', p_max, 'correct', true, 'manual', false);
    end if;
    if mode = 'PARTIAL' then
      -- choosing extra options dilutes the credit (choosing everything never earns full marks)
      return jsonb_build_object('score', round(p_max * hits / greatest(n, cardinality(chosen)), 2), 'correct', false, 'manual', false);
    elsif mode = 'PARTIAL_PENALTY' then
      return jsonb_build_object('score', round(p_max * greatest(hits - wrongs, 0) / n, 2), 'correct', false, 'manual', false);
    end if;
    return jsonb_build_object('score', 0, 'correct', false, 'manual', false);

  elsif t = 'TRUE_FALSE' then
    return case when jsonb_typeof(r -> 'value') = 'boolean' and (r -> 'value') = (a -> 'value')
      then jsonb_build_object('score', p_max, 'correct', true, 'manual', false)
      else jsonb_build_object('score', 0, 'correct', false, 'manual', false) end;

  elsif t = 'NUMERIC' then
    if coalesce(jsonb_typeof(r -> 'value'), '') <> 'number' then return jsonb_build_object('score', 0, 'correct', false, 'manual', false); end if;
    v := (r ->> 'value')::numeric;
    return case when abs(v - (a ->> 'value')::numeric) <= coalesce((a ->> 'tolerance')::numeric, 0)
      then jsonb_build_object('score', p_max, 'correct', true, 'manual', false)
      else jsonb_build_object('score', 0, 'correct', false, 'manual', false) end;

  elsif t = 'SHORT' then
    txt := regexp_replace(trim(coalesce(r ->> 'text', '')), '\s+', ' ', 'g');
    for acc in select regexp_replace(trim(x), '\s+', ' ', 'g') from jsonb_array_elements_text(a -> 'accepted') x loop
      if (coalesce((a ->> 'caseSensitive')::boolean, false) and txt = acc) or (not coalesce((a ->> 'caseSensitive')::boolean, false) and lower(txt) = lower(acc)) then
        return jsonb_build_object('score', p_max, 'correct', true, 'manual', false);
      end if;
    end loop;
    return jsonb_build_object('score', 0, 'correct', false, 'manual', false);

  elsif t = 'ORDERING' then
    select array_agg(x) into correct from jsonb_array_elements_text(a -> 'order') x;
    select array_agg(x) into chosen from jsonb_array_elements_text(coalesce(r -> 'order', '[]'::jsonb)) x;
    if chosen = correct then return jsonb_build_object('score', p_max, 'correct', true, 'manual', false); end if;
    if mode = 'PARTIAL' and chosen is not null then
      ok := (select count(*) from generate_subscripts(correct, 1) i where i <= cardinality(chosen) and chosen[i] = correct[i]);
      return jsonb_build_object('score', round(p_max * ok / cardinality(correct), 2), 'correct', false, 'manual', false);
    end if;
    return jsonb_build_object('score', 0, 'correct', false, 'manual', false);

  elsif t = 'MATCHING' then
    n := (select count(*) from jsonb_object_keys(a -> 'pairs'));
    ok := 0;
    for k in select jsonb_object_keys(a -> 'pairs') loop
      if (r -> 'pairs' ->> k) = (a -> 'pairs' ->> k) then ok := ok + 1; end if;
    end loop;
    if ok = n then return jsonb_build_object('score', p_max, 'correct', true, 'manual', false); end if;
    if mode = 'PARTIAL' then return jsonb_build_object('score', round(p_max * ok / n, 2), 'correct', false, 'manual', false); end if;
    return jsonb_build_object('score', 0, 'correct', false, 'manual', false);
  end if;
  return jsonb_build_object('score', 0, 'correct', false, 'manual', false);
end $$;

-- is a response well-formed for this public question? (ids must be ones the learner was shown)
create or replace function public.exam_response_ok(p_pub jsonb, p_resp jsonb)
returns boolean
language plpgsql
immutable
set search_path = public
as $$
declare t text := p_pub ->> 'type'; ids text[]; got text[]; k text;
begin
  if p_resp is null or p_resp = 'null'::jsonb then return true; end if;
  if jsonb_typeof(p_resp) <> 'object' or length(p_resp::text) > 25000 then return false; end if;
  if t in ('MCQ', 'MULTI') then
    select array_agg(o ->> 'id') into ids from jsonb_array_elements(p_pub -> 'options') o;
    if t = 'MCQ' then return (p_resp ->> 'choice') = any(ids); end if;
    if coalesce(jsonb_typeof(p_resp -> 'choices'), '') <> 'array' then return false; end if;
    select coalesce(array_agg(x), '{}') into got from jsonb_array_elements_text(p_resp -> 'choices') x;
    return got <@ ids;
  elsif t = 'TRUE_FALSE' then return jsonb_typeof(p_resp -> 'value') = 'boolean';
  elsif t = 'NUMERIC' then return jsonb_typeof(p_resp -> 'value') = 'number';
  elsif t = 'SHORT' then return jsonb_typeof(p_resp -> 'text') = 'string' and length(p_resp ->> 'text') <= 500;
  elsif t = 'ESSAY' then return jsonb_typeof(p_resp -> 'text') = 'string' and length(p_resp ->> 'text') <= 20000;
  elsif t = 'ORDERING' then
    select array_agg(o ->> 'id') into ids from jsonb_array_elements(p_pub -> 'items') o;
    if coalesce(jsonb_typeof(p_resp -> 'order'), '') <> 'array' then return false; end if;
    select array_agg(x) into got from jsonb_array_elements_text(p_resp -> 'order') x;
    return cardinality(got) = cardinality(ids) and got @> ids and ids @> got;
  elsif t = 'MATCHING' then
    if coalesce(jsonb_typeof(p_resp -> 'pairs'), '') <> 'object' then return false; end if;
    select array_agg(o ->> 'id') into ids from jsonb_array_elements(p_pub -> 'right') o;
    for k in select jsonb_object_keys(p_resp -> 'pairs') loop
      if not exists (select 1 from jsonb_array_elements(p_pub -> 'left') l where l ->> 'id' = k) then return false; end if;
      if not ((p_resp -> 'pairs' ->> k) = any(ids)) then return false; end if;
    end loop;
    return true;
  end if;
  return false;
end $$;

-- recompute totals of an attempt from its questions
create or replace function public.exam_attempt_recalc(p_attempt text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare a public."ExamAttempt"; v_pass numeric; v_manual boolean;
begin
  select * into a from public."ExamAttempt" where "id" = p_attempt;
  v_manual := exists (select 1 from public."AttemptQuestion" where "attemptId" = p_attempt and "type" = 'ESSAY' and "manualScore" is null);
  v_pass := coalesce((a."settings" ->> 'passPercent')::numeric, 70);
  update public."ExamAttempt" x set
    "maxScore" = s.mx, "score" = s.sc,
    "percent" = case when s.mx > 0 then round(100 * s.sc / s.mx, 2) end,
    "passed" = case when v_manual or s.mx = 0 then null else (100 * s.sc / s.mx) >= v_pass end,
    "questionCount" = s.n, "answeredCount" = s.answered, "flaggedCount" = s.flagged,
    "correctCount" = s.okc, "wrongCount" = s.bad, "needsManual" = v_manual,
    "status" = case when x."status" = 'SUBMITTED' and not v_manual then 'COMPLETED'
                    when x."status" = 'COMPLETED' and v_manual then 'SUBMITTED' else x."status" end,
    "gradedAt" = case when not v_manual then now() end, "updatedAt" = now()
  from (
    select coalesce(sum(q."points"), 0) mx,
           coalesce(sum(coalesce(q."manualScore", q."score", 0)), 0) sc,
           count(*) n,
           count(*) filter (where q."response" is not null and q."response" <> 'null'::jsonb) answered,
           count(*) filter (where q."flagged") flagged,
           count(*) filter (where q."isCorrect") okc,
           count(*) filter (where q."isCorrect" = false) bad
    from public."AttemptQuestion" q where q."attemptId" = p_attempt) s
  where x."id" = p_attempt;
end $$;

-- grade every question and close the attempt. p_status: COMPLETED | TIMED_OUT | ABANDONED
create or replace function public.exam_attempt_finalize(p_attempt text, p_status text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare q public."AttemptQuestion"; g jsonb;
begin
  for q in select * from public."AttemptQuestion" where "attemptId" = p_attempt loop
    g := public.exam_grade(q."snapshot", q."response", q."points");
    update public."AttemptQuestion" set "score" = (g ->> 'score')::numeric, "isCorrect" = (g ->> 'correct')::boolean where "id" = q."id";
  end loop;
  update public."ExamAttempt" set "status" = case when p_status = 'COMPLETED' then 'SUBMITTED' else p_status end,
    "submittedAt" = now(), "updatedAt" = now()
  where "id" = p_attempt;
  -- recalc turns SUBMITTED into COMPLETED when nothing needs manual grading
  perform public.exam_attempt_recalc(p_attempt);
  perform public.exam_log('attempt.' || lower(p_status), 'ExamAttempt', p_attempt, (select "programId" from public."ExamAttempt" where "id" = p_attempt), null);
end $$;

-- close an expired / deserted attempt (called before any read or write)
create or replace function public.exam_attempt_enforce_time(p_attempt text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare a public."ExamAttempt";
begin
  select * into a from public."ExamAttempt" where "id" = p_attempt for update;
  if a."status" <> 'IN_PROGRESS' then return; end if;
  if a."deadlineAt" is not null and now() > a."deadlineAt" + make_interval(secs => a."graceSeconds") then
    perform public.exam_attempt_finalize(p_attempt, 'TIMED_OUT');
  elsif a."settings" ->> 'resumePolicy' = 'NO_RESUME' and now() - a."lastSeenAt" > interval '2 minutes' then
    perform public.exam_attempt_finalize(p_attempt, 'ABANDONED');
  end if;
end $$;

create or replace function public.exam_own_attempt(p_attempt text)
returns public."ExamAttempt"
language plpgsql
security definer
set search_path = public
as $$
declare me public."ExamMember" := public.exam_current_member(); a public."ExamAttempt";
begin
  select * into a from public."ExamAttempt" where "id" = p_attempt;
  if a."id" is null or me."id" is null or a."memberId" <> me."id" then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  return a;
end $$;

create or replace function public.exam_results_visible(p_attempt public."ExamAttempt")
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_attempt."status" not in ('IN_PROGRESS', 'CANCELLED') and exists (
    select 1 from public."Exam" e where e."id" = p_attempt."examId" and (
      e."resultsPolicy" = 'IMMEDIATE'
      or (e."resultsPolicy" = 'AFTER_CLOSE' and e."endsAt" is not null and now() > e."endsAt")
      or (e."resultsPolicy" = 'MANUAL' and e."resultsReleasedAt" is not null)))
$$;

create or replace function public.exam_review_visible(p_attempt public."ExamAttempt")
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.exam_results_visible(p_attempt) and exists (
    select 1 from public."Exam" e where e."id" = p_attempt."examId" and (
      e."reviewPolicy" = 'AFTER_SUBMIT'
      or (e."reviewPolicy" = 'AFTER_CLOSE' and e."endsAt" is not null and now() > e."endsAt")))
$$;

create or replace function public.exam_attempts_allowed(p_exam text, p_member text)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select case when e."maxAttempts" is null then null
    else e."maxAttempts" + coalesce((select "extra" from public."ExamExtraAttempt" x where x."examId" = e."id" and x."memberId" = p_member), 0) end
  from public."Exam" e where e."id" = p_exam
$$;

-- ── learner-facing ──

-- What a learner needs before starting: public exam info, attempts used/allowed, whether they can start
create or replace function public.exam_take_info(p_exam text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  e public."Exam"; me public."ExamMember" := public.exam_current_member(); v_access text; v_used int; v_allowed int;
  v_reason text := null; v_open public."ExamAttempt"; a public."ExamAttempt";
begin
  select * into e from public."Exam" where "id" = p_exam;
  if e."id" is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  v_access := public.exam_course_access(e."programId");
  if v_access is null or (v_access = 'LEARNER' and e."status" <> 'PUBLISHED') then raise exception 'forbidden' using errcode = '42501'; end if;

  for a in select * from public."ExamAttempt" where "examId" = p_exam and "memberId" = me."id" and "status" = 'IN_PROGRESS' loop
    perform public.exam_attempt_enforce_time(a."id");
  end loop;
  select * into v_open from public."ExamAttempt" where "examId" = p_exam and "memberId" = me."id" and "status" = 'IN_PROGRESS' limit 1;
  v_used := (select count(*) from public."ExamAttempt" where "examId" = p_exam and "memberId" = me."id" and "status" <> 'CANCELLED');
  v_allowed := public.exam_attempts_allowed(p_exam, me."id");

  if v_open."id" is not null then v_reason := 'in_progress';
  elsif e."status" <> 'PUBLISHED' then v_reason := 'not_published';
  elsif e."startsAt" is not null and now() < e."startsAt" then v_reason := 'not_open_yet';
  elsif e."endsAt" is not null and now() > e."endsAt" then v_reason := 'closed';
  elsif v_allowed is not null and v_used >= v_allowed then v_reason := 'no_attempts_left';
  end if;

  return jsonb_build_object(
    'id', e."id", 'programId', e."programId", 'folderId', e."folderId", 'titleAr', e."titleAr", 'titleEn', e."titleEn",
    'descAr', e."descAr", 'descEn', e."descEn", 'examType', e."examType", 'durationMinutes', e."durationMinutes",
    'startsAt', e."startsAt", 'endsAt', e."endsAt", 'passPercent', e."passPercent", 'status', e."status",
    'questionCount', (public.exam_exam_check_json(e."id") ->> 'questionCount')::int,
    'tools', jsonb_build_object('calculator', e."allowCalculator", 'whiteboard', e."allowWhiteboard", 'translation', e."allowTranslation"),
    'security', e."security", 'resumePolicy', e."resumePolicy", 'reviewPolicy', e."reviewPolicy", 'resultsPolicy', e."resultsPolicy",
    'attemptsUsed', v_used, 'attemptsAllowed', v_allowed, 'canStart', v_reason is null, 'reason', v_reason,
    'openAttemptId', v_open."id",
    'attempts', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', x."id", 'attemptNo', x."attemptNo", 'status', x."status", 'startedAt', x."startedAt", 'submittedAt', x."submittedAt",
        'resultsVisible', public.exam_results_visible(x), 'reviewVisible', public.exam_review_visible(x),
        'score', case when public.exam_results_visible(x) then x."score" end,
        'maxScore', case when public.exam_results_visible(x) then x."maxScore" end,
        'percent', case when public.exam_results_visible(x) then x."percent" end,
        'passed', case when public.exam_results_visible(x) then x."passed" end,
        'needsManual', x."needsManual") order by x."attemptNo" desc), '[]'::jsonb)
      from public."ExamAttempt" x where x."examId" = p_exam and x."memberId" = me."id"));
end $$;

-- Start (or resume) an attempt. Returns {attemptId}.
create or replace function public.exam_attempt_start(p_exam text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  info jsonb := public.exam_take_info(p_exam);
  e public."Exam"; me public."ExamMember" := public.exam_current_member();
  it record; r public."ExamRule"; v_rows jsonb := '[]'::jsonb; v_ids text[] := '{}'; v_draw record; v_attempt text;
  v_deadline timestamptz; rw record; v_pos int := 0; v_snap jsonb; v_imgs jsonb; v_scen jsonb := '{}'::jsonb; v_sid text;
begin
  if info ->> 'reason' = 'in_progress' then
    return jsonb_build_object('attemptId', info ->> 'openAttemptId', 'resumed', true);
  end if;
  if not (info ->> 'canStart')::boolean then
    raise exception 'cannot_start: %', info ->> 'reason' using errcode = '42501';
  end if;
  select * into e from public."Exam" where "id" = p_exam;
  if not (public.exam_exam_check_json(p_exam) ->> 'ok')::boolean then raise exception 'cannot_start: not_ready' using errcode = '42501'; end if;

  -- 1. hand-picked questions (a scenario's questions travel together)
  for it in select i."questionId" qid, q."scenarioId" sid, i."position" pos, i."points" pts, i."weight" wt
            from public."ExamItem" i join public."Question" q on q."id" = i."questionId"
            where i."examId" = p_exam and q."status" = 'ACTIVE' order by i."position" loop
    v_rows := v_rows || jsonb_build_object('qid', it.qid, 'grp', coalesce(it.sid, it.qid), 'ord', it.pos, 'pts', it.pts, 'wt', it.wt);
    v_ids := v_ids || it.qid;
  end loop;
  -- 2. random rules
  for r in select * from public."ExamRule" where "examId" = p_exam order by "position" loop
    if r."scenarios" then
      for v_draw in
        select q."id" qid, s.sid, q."scenarioOrder" ord
        from (select sid from public.exam_rule_scenarios(r, e."programId") sid order by random() limit r."count") s
        join public."Question" q on q."scenarioId" = s.sid and q."status" = 'ACTIVE'
        where not q."id" = any(v_ids)
      loop
        v_rows := v_rows || jsonb_build_object('qid', v_draw.qid, 'grp', v_draw.sid, 'ord', 100000 + v_draw.ord, 'pts', null, 'wt', null);
        v_ids := v_ids || v_draw.qid;
      end loop;
    else
      for v_draw in select id qid from public.exam_rule_pool(r, e."programId") id where not id = any(v_ids) order by random() limit r."count" loop
        v_rows := v_rows || jsonb_build_object('qid', v_draw.qid, 'grp', v_draw.qid, 'ord', 200000 + cardinality(v_ids), 'pts', r."points", 'wt', r."weight");
        v_ids := v_ids || v_draw.qid;
      end loop;
    end if;
  end loop;
  if cardinality(v_ids) = 0 then raise exception 'cannot_start: not_ready' using errcode = '42501'; end if;

  v_deadline := case when e."durationMinutes" is not null then now() + make_interval(mins => e."durationMinutes") end;
  if e."endsAt" is not null and (v_deadline is null or e."endsAt" < v_deadline) then v_deadline := e."endsAt"; end if;

  insert into public."ExamAttempt" ("examId", "programId", "memberId", "attemptNo", "deadlineAt", "graceSeconds", "settings")
  values (p_exam, e."programId", me."id",
    (select coalesce(max("attemptNo"), 0) + 1 from public."ExamAttempt" where "examId" = p_exam and "memberId" = me."id"),
    v_deadline, e."graceSeconds",
    jsonb_build_object('passPercent', e."passPercent", 'reviewPolicy', e."reviewPolicy", 'resultsPolicy', e."resultsPolicy",
      'showCorrect', e."showCorrect", 'showFeedback', e."showFeedback", 'showExplanation', e."showExplanation",
      'calculator', e."allowCalculator", 'whiteboard', e."allowWhiteboard", 'translation', e."allowTranslation",
      'resumePolicy', e."resumePolicy", 'security', e."security", 'examVersion', e."version"))
  returning "id" into v_attempt;

  -- 3. order: groups shuffled (if enabled), questions of a scenario stay together in their order
  for rw in
    with x as (select * from jsonb_to_recordset(v_rows) as t(qid text, grp text, ord int, pts numeric, wt numeric)),
         g as (select grp, min(ord) first_ord, random() rnd from x group by grp)
    select x.* from x join g using (grp)
    order by case when e."shuffleQuestions" then g.rnd else g.first_ord end, x.ord
  loop
    v_pos := v_pos + 1;
    select v."snapshot" into v_snap from public."QuestionVersion" v join public."Question" q on q."id" = v."questionId" and v."version" = q."version"
      where v."questionId" = rw.qid;
    if v_snap is null then v_snap := public.exam_bank_question_json(rw.qid); end if;
    select coalesce(jsonb_agg(jsonb_build_object('path', a."path", 'kind', a."kind", 'captionAr', a."captionAr", 'captionEn', a."captionEn") order by a."sortOrder"), '[]'::jsonb)
      into v_imgs from public."ExamAsset" a where a."ownerType" = 'QUESTION' and a."ownerId" = rw.qid;
    insert into public."AttemptQuestion" ("attemptId", "position", "questionId", "questionVersion", "scenarioId", "type", "points", "publicData", "snapshot")
    values (v_attempt, v_pos, rw.qid, coalesce((v_snap ->> 'version')::int, 1), v_snap ->> 'scenarioId', v_snap ->> 'type',
      round(coalesce(rw.pts, (v_snap ->> 'points')::numeric, 1) * coalesce(rw.wt, (v_snap ->> 'weight')::numeric, 1), 2),
      public.exam_public_question(v_snap, e."shuffleOptions", v_imgs) || jsonb_build_object('scenarioId', v_snap ->> 'scenarioId'),
      v_snap);
  end loop;

  -- 4. freeze the public part of the scenarios used
  for v_sid in select distinct "scenarioId" from public."AttemptQuestion" where "attemptId" = v_attempt and "scenarioId" is not null loop
    v_scen := v_scen || jsonb_build_object(v_sid, (
      select jsonb_build_object('id', s."id", 'titleAr', s."titleAr", 'titleEn', s."titleEn", 'bodyAr', s."bodyAr", 'bodyEn', s."bodyEn",
        'details', s."details", 'tables', s."tables", 'displayMode', s."displayMode",
        'images', (select coalesce(jsonb_agg(jsonb_build_object('path', a."path", 'kind', a."kind", 'captionAr', a."captionAr", 'captionEn', a."captionEn") order by a."sortOrder"), '[]'::jsonb)
                   from public."ExamAsset" a where a."ownerType" = 'SCENARIO' and a."ownerId" = s."id"))
      from public."Scenario" s where s."id" = v_sid));
  end loop;
  update public."ExamAttempt" set "settings" = "settings" || jsonb_build_object('scenarios', v_scen), "questionCount" = v_pos where "id" = v_attempt;

  perform public.exam_log('attempt.start', 'ExamAttempt', v_attempt, e."programId", jsonb_build_object('exam', p_exam, 'questions', v_pos));
  return jsonb_build_object('attemptId', v_attempt, 'resumed', false);
end $$;

-- Current state of an own attempt — public data only
create or replace function public.exam_attempt_state(p_attempt text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare a public."ExamAttempt" := public.exam_own_attempt(p_attempt); me public."ExamMember" := public.exam_current_member(); e public."Exam";
begin
  perform public.exam_attempt_enforce_time(p_attempt);
  select * into a from public."ExamAttempt" where "id" = p_attempt;
  select * into e from public."Exam" where "id" = a."examId";
  if a."status" = 'IN_PROGRESS' then
    update public."ExamAttempt" set "lastSeenAt" = now() where "id" = p_attempt;
  end if;
  return jsonb_build_object(
    'id', a."id", 'examId', a."examId", 'attemptNo', a."attemptNo", 'status', a."status",
    'titleAr', e."titleAr", 'titleEn', e."titleEn", 'serverNow', now(), 'deadlineAt', a."deadlineAt", 'graceSeconds', a."graceSeconds",
    'tools', jsonb_build_object('calculator', a."settings" -> 'calculator', 'whiteboard', a."settings" -> 'whiteboard', 'translation', a."settings" -> 'translation'),
    'security', a."settings" -> 'security',
    'watermark', left(me."id", 8) || ' · ' || left(a."id", 8),
    'scenarios', case when a."status" = 'IN_PROGRESS' then coalesce(a."settings" -> 'scenarios', '{}'::jsonb) else '{}'::jsonb end,
    'questions', case when a."status" = 'IN_PROGRESS' then (
      select coalesce(jsonb_agg(jsonb_build_object('id', q."id", 'position', q."position", 'points', q."points",
        'data', q."publicData", 'response', q."response", 'flagged', q."flagged") order by q."position"), '[]'::jsonb)
      from public."AttemptQuestion" q where q."attemptId" = p_attempt) else '[]'::jsonb end);
end $$;

-- Save one answer (and/or the review flag). Refused after the server deadline + grace.
create or replace function public.exam_attempt_save(p_attempt text, p_question text, p_response jsonb, p_flagged boolean default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare a public."ExamAttempt" := public.exam_own_attempt(p_attempt); q public."AttemptQuestion";
begin
  perform public.exam_attempt_enforce_time(p_attempt);
  select * into a from public."ExamAttempt" where "id" = p_attempt;
  if a."status" <> 'IN_PROGRESS' then raise exception 'attempt_closed' using errcode = '42501'; end if;
  select * into q from public."AttemptQuestion" where "id" = p_question and "attemptId" = p_attempt;
  if q."id" is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  if not public.exam_response_ok(q."publicData", p_response) then raise exception 'invalid_response' using errcode = '22023'; end if;
  update public."AttemptQuestion" set "response" = case when p_response is null or p_response = 'null'::jsonb then null else p_response end,
    "flagged" = coalesce(p_flagged, "flagged"), "savedAt" = now()
  where "id" = p_question;
  update public."ExamAttempt" set "lastSeenAt" = now() where "id" = p_attempt;
  return jsonb_build_object('saved', true, 'serverNow', now(), 'deadlineAt', a."deadlineAt");
end $$;

create or replace function public.exam_attempt_submit(p_attempt text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare a public."ExamAttempt" := public.exam_own_attempt(p_attempt);
begin
  perform public.exam_attempt_enforce_time(p_attempt);
  select * into a from public."ExamAttempt" where "id" = p_attempt;
  if a."status" = 'IN_PROGRESS' then
    perform public.exam_attempt_finalize(p_attempt, 'COMPLETED');
  end if;
  return public.exam_attempt_review(p_attempt);
end $$;

-- Result + (if allowed) question-by-question review of an own finished attempt
create or replace function public.exam_attempt_review(p_attempt text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare a public."ExamAttempt" := public.exam_own_attempt(p_attempt); e public."Exam"; v_res boolean; v_rev boolean;
begin
  perform public.exam_attempt_enforce_time(p_attempt);
  select * into a from public."ExamAttempt" where "id" = p_attempt;
  select * into e from public."Exam" where "id" = a."examId";
  v_res := public.exam_results_visible(a);
  v_rev := public.exam_review_visible(a);
  return jsonb_build_object(
    'id', a."id", 'examId', a."examId", 'attemptNo', a."attemptNo", 'status', a."status", 'titleAr', e."titleAr", 'titleEn', e."titleEn",
    'startedAt', a."startedAt", 'submittedAt', a."submittedAt", 'questionCount', a."questionCount", 'answeredCount', a."answeredCount",
    'resultsVisible', v_res, 'reviewVisible', v_rev, 'needsManual', a."needsManual",
    'score', case when v_res then a."score" end, 'maxScore', case when v_res then a."maxScore" end,
    'percent', case when v_res then a."percent" end, 'passed', case when v_res then a."passed" end,
    'passPercent', a."settings" -> 'passPercent',
    'correctCount', case when v_res then a."correctCount" end, 'wrongCount', case when v_res then a."wrongCount" end,
    'scenarios', case when v_rev then coalesce(a."settings" -> 'scenarios', '{}'::jsonb) else '{}'::jsonb end,
    'questions', case when v_rev then (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', q."id", 'position', q."position", 'points', q."points", 'data', q."publicData", 'response', q."response",
        'score', coalesce(q."manualScore", q."score"), 'isCorrect', q."isCorrect", 'graderComment', q."graderComment",
        'answer', case when (a."settings" ->> 'showCorrect')::boolean then q."snapshot" -> 'answer' end,
        'feedbackAr', case when (a."settings" ->> 'showFeedback')::boolean then q."snapshot" ->> 'feedbackAr' end,
        'feedbackEn', case when (a."settings" ->> 'showFeedback')::boolean then q."snapshot" ->> 'feedbackEn' end,
        'explanationAr', case when (a."settings" ->> 'showExplanation')::boolean then q."snapshot" ->> 'explanationAr' end,
        'explanationEn', case when (a."settings" ->> 'showExplanation')::boolean then q."snapshot" ->> 'explanationEn' end,
        'optionRationale', case when (a."settings" ->> 'showExplanation')::boolean then q."snapshot" -> 'optionRationale' end,
        'reference', case when (a."settings" ->> 'showExplanation')::boolean then q."snapshot" ->> 'reference' end
      ) order by q."position"), '[]'::jsonb)
      from public."AttemptQuestion" q where q."attemptId" = p_attempt) else '[]'::jsonb end);
end $$;

-- ── staff ──

create or replace function public.exam_exam_attempts(p_exam text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare e public."Exam"; a record;
begin
  select * into e from public."Exam" where "id" = p_exam;
  if e."id" is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  if not public.exam_instructor_can(e."programId", 'canViewResults') then raise exception 'forbidden' using errcode = '42501'; end if;
  for a in select "id" from public."ExamAttempt" where "examId" = p_exam and "status" = 'IN_PROGRESS' loop
    perform public.exam_attempt_enforce_time(a."id");
  end loop;
  return jsonb_build_object(
    'exam', jsonb_build_object('id', e."id", 'titleAr', e."titleAr", 'titleEn', e."titleEn", 'programId', e."programId", 'folderId', e."folderId",
      'resultsPolicy', e."resultsPolicy", 'resultsReleasedAt', e."resultsReleasedAt", 'maxAttempts', e."maxAttempts"),
    'can', jsonb_build_object('grade', public.exam_instructor_can(e."programId", 'canReviewEssays'), 'reopen', public.exam_instructor_can(e."programId", 'canReopenAttempts'),
      'release', public.exam_can_edit_exams(e."folderId")),
    'attempts', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', x."id", 'attemptNo', x."attemptNo", 'status', x."status", 'name', m."name", 'email', m."email", 'memberId', m."id",
        'startedAt', x."startedAt", 'submittedAt', x."submittedAt", 'score', x."score", 'maxScore', x."maxScore", 'percent', x."percent",
        'passed', x."passed", 'answeredCount', x."answeredCount", 'questionCount', x."questionCount", 'needsManual', x."needsManual", 'warnings', x."warnings")
        order by x."startedAt" desc), '[]'::jsonb)
      from public."ExamAttempt" x join public."ExamMember" m on m."id" = x."memberId" where x."examId" = p_exam));
end $$;

create or replace function public.exam_attempt_detail(p_attempt text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare a public."ExamAttempt"; m public."ExamMember";
begin
  select * into a from public."ExamAttempt" where "id" = p_attempt;
  if a."id" is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  if not public.exam_instructor_can(a."programId", 'canViewResults') then raise exception 'forbidden' using errcode = '42501'; end if;
  perform public.exam_attempt_enforce_time(p_attempt);
  select * into a from public."ExamAttempt" where "id" = p_attempt;
  select * into m from public."ExamMember" where "id" = a."memberId";
  return to_jsonb(a) - 'settings' || jsonb_build_object('name', m."name", 'email', m."email",
    'scenarios', coalesce(a."settings" -> 'scenarios', '{}'::jsonb), 'passPercent', a."settings" -> 'passPercent',
    'questions', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', q."id", 'position', q."position", 'type', q."type", 'points', q."points", 'data', q."publicData", 'response', q."response",
        'flagged', q."flagged", 'score', q."score", 'manualScore', q."manualScore", 'isCorrect', q."isCorrect", 'graderComment', q."graderComment",
        'answer', q."snapshot" -> 'answer', 'rubricAr', q."snapshot" -> 'answer' ->> 'rubricAr', 'questionVersion', q."questionVersion")
        order by q."position"), '[]'::jsonb)
      from public."AttemptQuestion" q where q."attemptId" = p_attempt));
end $$;

-- Grade an essay answer (0 … points of the question)
create or replace function public.exam_attempt_grade(p_question text, p_score numeric, p_comment text default '')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare q public."AttemptQuestion"; a public."ExamAttempt"; me public."ExamMember";
begin
  select * into q from public."AttemptQuestion" where "id" = p_question;
  if q."id" is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  select * into a from public."ExamAttempt" where "id" = q."attemptId";
  me := public.exam_require_perm(a."programId", 'canReviewEssays');
  if q."type" <> 'ESSAY' then raise exception 'invalid_grade: not_essay'; end if;
  if a."status" in ('IN_PROGRESS', 'CANCELLED') then raise exception 'invalid_grade: status'; end if;
  if p_score is null or p_score < 0 or p_score > q."points" then raise exception 'invalid_grade: score'; end if;
  update public."AttemptQuestion" set "manualScore" = p_score, "isCorrect" = (p_score >= q."points"), "graderComment" = left(coalesce(p_comment, ''), 3000),
    "gradedById" = me."id", "gradedAt" = now() where "id" = p_question;
  perform public.exam_attempt_recalc(a."id");
  perform public.exam_log('attempt.grade', 'AttemptQuestion', p_question, a."programId", jsonb_build_object('score', p_score));
  return public.exam_attempt_detail(a."id");
end $$;

-- Reopen a finished attempt for p_minutes more (time counts from now)
create or replace function public.exam_attempt_reopen(p_attempt text, p_minutes int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare a public."ExamAttempt";
begin
  select * into a from public."ExamAttempt" where "id" = p_attempt;
  if a."id" is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  perform public.exam_require_perm(a."programId", 'canReopenAttempts');
  if a."status" in ('IN_PROGRESS', 'CANCELLED') then raise exception 'invalid_grade: status'; end if;
  if p_minutes is null or p_minutes < 1 or p_minutes > 600 then raise exception 'invalid_grade: minutes'; end if;
  update public."ExamAttempt" set "status" = 'IN_PROGRESS', "deadlineAt" = now() + make_interval(mins => p_minutes), "lastSeenAt" = now(),
    "submittedAt" = null, "gradedAt" = null, "updatedAt" = now() where "id" = p_attempt;
  perform public.exam_log('attempt.reopen', 'ExamAttempt', p_attempt, a."programId", jsonb_build_object('minutes', p_minutes));
  return public.exam_attempt_detail(p_attempt);
end $$;

create or replace function public.exam_attempt_cancel(p_attempt text, p_note text default '')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare a public."ExamAttempt";
begin
  select * into a from public."ExamAttempt" where "id" = p_attempt;
  if a."id" is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  perform public.exam_require_perm(a."programId", 'canReopenAttempts');
  update public."ExamAttempt" set "status" = 'CANCELLED', "staffNote" = left(coalesce(p_note, ''), 2000), "updatedAt" = now() where "id" = p_attempt;
  perform public.exam_log('attempt.cancel', 'ExamAttempt', p_attempt, a."programId", jsonb_build_object('note', p_note));
  return public.exam_attempt_detail(p_attempt);
end $$;

create or replace function public.exam_grant_attempt(p_exam text, p_member text, p_extra int default 1)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare e public."Exam"; me public."ExamMember";
begin
  select * into e from public."Exam" where "id" = p_exam;
  if e."id" is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  me := public.exam_require_perm(e."programId", 'canReopenAttempts');
  if p_extra is null or p_extra < 1 or p_extra > 20 then raise exception 'invalid_grade: extra'; end if;
  insert into public."ExamExtraAttempt" ("examId", "memberId", "extra", "createdById") values (p_exam, p_member, p_extra, me."id")
  on conflict ("examId", "memberId") do update set "extra" = "ExamExtraAttempt"."extra" + excluded."extra";
  perform public.exam_log('attempt.grant', 'Exam', p_exam, e."programId", jsonb_build_object('member', p_member, 'extra', p_extra));
  return jsonb_build_object('granted', p_extra);
end $$;

-- For resultsPolicy MANUAL: release results to learners
create or replace function public.exam_exam_release_results(p_exam text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare e public."Exam";
begin
  select * into e from public."Exam" where "id" = p_exam;
  if e."id" is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  perform public.exam_require_exam_editor(e."folderId");
  update public."Exam" set "resultsReleasedAt" = now() where "id" = p_exam;
  perform public.exam_log('exam.release_results', 'Exam', p_exam, e."programId", null);
  return jsonb_build_object('released', true);
end $$;

-- ── access ──
do $$
declare t text;
begin
  foreach t in array array['ExamAttempt', 'AttemptQuestion', 'ExamExtraAttempt'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;

revoke all on function public.exam_public_question(jsonb, boolean, jsonb) from public, anon, authenticated;
revoke all on function public.exam_grade(jsonb, jsonb, numeric) from public, anon, authenticated;
revoke all on function public.exam_response_ok(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.exam_attempt_recalc(text) from public, anon, authenticated;
revoke all on function public.exam_attempt_finalize(text, text) from public, anon, authenticated;
revoke all on function public.exam_attempt_enforce_time(text) from public, anon, authenticated;
revoke all on function public.exam_own_attempt(text) from public, anon, authenticated;
revoke all on function public.exam_results_visible(public."ExamAttempt") from public, anon, authenticated;
revoke all on function public.exam_review_visible(public."ExamAttempt") from public, anon, authenticated;
revoke all on function public.exam_attempts_allowed(text, text) from public, anon, authenticated;

revoke all on function public.exam_take_info(text) from public, anon;
revoke all on function public.exam_attempt_start(text) from public, anon;
revoke all on function public.exam_attempt_state(text) from public, anon;
revoke all on function public.exam_attempt_save(text, text, jsonb, boolean) from public, anon;
revoke all on function public.exam_attempt_submit(text) from public, anon;
revoke all on function public.exam_attempt_review(text) from public, anon;
revoke all on function public.exam_exam_attempts(text) from public, anon;
revoke all on function public.exam_attempt_detail(text) from public, anon;
revoke all on function public.exam_attempt_grade(text, numeric, text) from public, anon;
revoke all on function public.exam_attempt_reopen(text, int) from public, anon;
revoke all on function public.exam_attempt_cancel(text, text) from public, anon;
revoke all on function public.exam_grant_attempt(text, text, int) from public, anon;
revoke all on function public.exam_exam_release_results(text) from public, anon;

grant execute on function public.exam_take_info(text) to authenticated;
grant execute on function public.exam_attempt_start(text) to authenticated;
grant execute on function public.exam_attempt_state(text) to authenticated;
grant execute on function public.exam_attempt_save(text, text, jsonb, boolean) to authenticated;
grant execute on function public.exam_attempt_submit(text) to authenticated;
grant execute on function public.exam_attempt_review(text) to authenticated;
grant execute on function public.exam_exam_attempts(text) to authenticated;
grant execute on function public.exam_attempt_detail(text) to authenticated;
grant execute on function public.exam_attempt_grade(text, numeric, text) to authenticated;
grant execute on function public.exam_attempt_reopen(text, int) to authenticated;
grant execute on function public.exam_attempt_cancel(text, text) to authenticated;
grant execute on function public.exam_grant_attempt(text, text, int) to authenticated;
grant execute on function public.exam_exam_release_results(text) to authenticated;
