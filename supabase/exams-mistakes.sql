-- ─────────────────────────────────────────────────────────────────────────────
-- Exam system · Phase 9 — Mistakes Quiz.
-- Applied by `npm run supabase:setup` after exams-security.sql (safe to run again).
--
--   • Collection: when an attempt is graded, every question the learner ANSWERED wrongly is added to their
--     personal mistakes list — once per question (repeat mistakes raise wrongCount and add history).
--   • Review sessions are personal: own score, own timer (optional), and they NEVER change official attempts.
--   • Status per question: WRONG_NOT_REVIEWED → REVIEWED (opened) / CORRECT_IN_REVIEW / WRONG_AGAIN →
--     MASTERED after N consecutive correct review sessions (N set by the admin, default 2). A later mistake
--     in an exam or a review puts a mastered question back (history is never deleted).
--   • Correct answer / feedback / explanation are revealed only as far as the ORIGINAL exam's review policy
--     allows (so the mistakes list can never be used to bypass an exam that hides answers).
-- ─────────────────────────────────────────────────────────────────────────────

-- ── helpers ──

create or replace function public.exam_mastery_streak()
returns int
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select least(greatest(nullif("value", '')::int, 1), 5) from public."Setting" where "key" = 'examMasteryStreak'), 2)
$$;

-- what of the answer may be shown for this mistake: {answer?, feedbackAr?, …} per the source attempt's policy
create or replace function public.exam_mistake_reveal(p_item public."MistakeItem")
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare a public."ExamAttempt"; s jsonb; v jsonb := '{}'::jsonb;
begin
  -- the most recent source attempt whose review is open decides what may be shown
  select x.* into a from public."MistakeHistory" h join public."ExamAttempt" x on x."id" = h."attemptId"
  where h."mistakeId" = p_item."id" and h."kind" = 'WRONG_IN_EXAM' and public.exam_review_visible(x)
  order by h."createdAt" desc limit 1;
  if a."id" is null then return v; end if;
  s := a."settings";
  if (s ->> 'showCorrect')::boolean then v := v || jsonb_build_object('answer', p_item."snapshot" -> 'answer'); end if;
  if (s ->> 'showFeedback')::boolean then
    v := v || jsonb_build_object('feedbackAr', p_item."snapshot" ->> 'feedbackAr', 'feedbackEn', p_item."snapshot" ->> 'feedbackEn');
  end if;
  if (s ->> 'showExplanation')::boolean then
    v := v || jsonb_build_object('explanationAr', p_item."snapshot" ->> 'explanationAr', 'explanationEn', p_item."snapshot" ->> 'explanationEn',
      'optionRationale', p_item."snapshot" -> 'optionRationale', 'reference', p_item."snapshot" ->> 'reference');
  end if;
  return v;
end $$;

-- a mistake is shown to the learner only once the result of at least one source attempt is released
-- (so the list never reveals which answers were wrong in an exam whose results are still hidden / held)
create or replace function public.exam_mistake_visible(p_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public."MistakeHistory" h join public."ExamAttempt" x on x."id" = h."attemptId"
                 where h."mistakeId" = p_id and h."kind" = 'WRONG_IN_EXAM' and public.exam_results_visible(x))
$$;

-- the scenario (case text) of a scenario question, as frozen in the source attempt
create or replace function public.exam_mistake_scenario(p_item public."MistakeItem")
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case when p_item."snapshot" ->> 'scenarioId' is not null then
    (select x."settings" -> 'scenarios' -> (p_item."snapshot" ->> 'scenarioId') from public."ExamAttempt" x where x."id" = p_item."lastAttemptId") end
$$;

create or replace function public.exam_mistake_summary(m public."MistakeItem")
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id', m."id", 'programId', m."programId", 'questionId', m."questionId", 'type', m."type",
    'stemAr', left(m."snapshot" ->> 'stemAr', 220), 'stemEn', left(m."snapshot" ->> 'stemEn', 220),
    'difficulty', m."difficulty", 'domainId', m."domainId", 'topicId', m."topicId", 'subtopicId', m."subtopicId",
    'domain', (select coalesce(nullif(c."nameAr", ''), c."nameEn") from public."QuestionCategory" c where c."id" = m."domainId"),
    'topic', (select coalesce(nullif(c."nameAr", ''), c."nameEn") from public."QuestionCategory" c where c."id" = m."topicId"),
    'status', m."status", 'wrongCount', m."wrongCount", 'reviewCorrect', m."reviewCorrect", 'reviewWrong', m."reviewWrong",
    'correctStreak', m."correctStreak", 'firstWrongAt', m."firstWrongAt", 'lastWrongAt', m."lastWrongAt",
    'lastReviewedAt', m."lastReviewedAt", 'masteredAt', m."masteredAt")
$$;

-- collect the wrongly answered questions of a graded attempt (idempotent per attempt)
create or replace function public.exam_collect_mistakes(p_attempt text)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare a public."ExamAttempt"; q public."AttemptQuestion"; m public."MistakeItem"; n int := 0;
begin
  select * into a from public."ExamAttempt" where "id" = p_attempt;
  if a."id" is null or a."status" in ('IN_PROGRESS', 'CANCELLED') then return 0; end if;
  for q in select * from public."AttemptQuestion"
           where "attemptId" = p_attempt and "isCorrect" = false and "response" is not null and "response" <> 'null'::jsonb loop
    select * into m from public."MistakeItem" where "memberId" = a."memberId" and "questionId" = q."questionId";
    if m."id" is not null and exists (select 1 from public."MistakeHistory" where "mistakeId" = m."id" and "kind" = 'WRONG_IN_EXAM' and "attemptId" = p_attempt) then
      continue; -- already collected from this attempt
    end if;
    if m."id" is null then
      insert into public."MistakeItem" ("memberId", "programId", "questionId", "questionVersion", "snapshot", "type", "domainId", "topicId", "subtopicId", "difficulty",
        "lastAttemptId", "lastExamId", "lastResponse")
      values (a."memberId", a."programId", q."questionId", q."questionVersion", q."snapshot", q."type",
        q."snapshot" ->> 'domainId', q."snapshot" ->> 'topicId', q."snapshot" ->> 'subtopicId', q."snapshot" ->> 'difficulty',
        a."id", a."examId", q."response")
      returning * into m;
    else
      if m."status" = 'MASTERED' then
        insert into public."MistakeHistory" ("mistakeId", "kind", "attemptId") values (m."id", 'REOPENED', p_attempt);
      end if;
      update public."MistakeItem" set "wrongCount" = "wrongCount" + 1, "lastWrongAt" = now(), "correctStreak" = 0,
        "status" = case when "status" = 'WRONG_NOT_REVIEWED' then 'WRONG_NOT_REVIEWED' else 'WRONG_AGAIN' end,
        "masteredAt" = null, "snapshot" = q."snapshot", "questionVersion" = q."questionVersion",
        "lastAttemptId" = a."id", "lastExamId" = a."examId", "lastResponse" = q."response", "updatedAt" = now()
      where "id" = m."id";
    end if;
    insert into public."MistakeHistory" ("mistakeId", "kind", "attemptId", "response") values (m."id", 'WRONG_IN_EXAM', p_attempt, q."response");
    n := n + 1;
  end loop;
  return n;
end $$;

-- ── learner ──

-- My mistakes: counts, filtered list, per-course and per-domain progress, open review session
create or replace function public.exam_mistakes_overview(p_program text default null, p_filter jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare me public."ExamMember" := public.exam_current_member(); f jsonb := coalesce(p_filter, '{}'::jsonb);
begin
  if me."id" is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  perform public.exam_rate_hit('mistakes', 60);
  if p_program is not null and public.exam_course_access(p_program) is null then raise exception 'forbidden' using errcode = '42501'; end if;
  return (
    with mine as (select * from public."MistakeItem" m where m."memberId" = me."id" and (p_program is null or m."programId" = p_program)
                    and public.exam_mistake_visible(m."id")),
    filtered as (
      select * from mine m
      where (nullif(f ->> 'status', '') is null or m."status" = f ->> 'status')
        and (nullif(f ->> 'domainId', '') is null or m."domainId" = f ->> 'domainId')
        and (nullif(f ->> 'topicId', '') is null or m."topicId" = f ->> 'topicId')
        and (nullif(f ->> 'difficulty', '') is null or m."difficulty" = f ->> 'difficulty')
        and (nullif(f ->> 'type', '') is null or m."type" = f ->> 'type'))
    select jsonb_build_object(
      'masteryStreak', public.exam_mastery_streak(),
      'counts', jsonb_build_object(
        'total', (select count(*) from mine),
        'notReviewed', (select count(*) from mine where "status" = 'WRONG_NOT_REVIEWED'),
        'reviewed', (select count(*) from mine where "status" = 'REVIEWED'),
        'correctInReview', (select count(*) from mine where "status" = 'CORRECT_IN_REVIEW'),
        'wrongAgain', (select count(*) from mine where "status" = 'WRONG_AGAIN'),
        'mastered', (select count(*) from mine where "status" = 'MASTERED'),
        'wrongTotal', (select coalesce(sum("wrongCount"), 0) from mine),
        'reviewCorrect', (select coalesce(sum("reviewCorrect"), 0) from mine),
        'reviewWrong', (select coalesce(sum("reviewWrong"), 0) from mine)),
      'items', (select coalesce(jsonb_agg(public.exam_mistake_summary(x) order by x."lastWrongAt" desc), '[]'::jsonb) from (select * from filtered limit 300) x),
      'byDomain', (select coalesce(jsonb_agg(jsonb_build_object('domainId', d, 'name',
                      (select coalesce(nullif(c."nameAr", ''), c."nameEn") from public."QuestionCategory" c where c."id" = d), 'total', t, 'mastered', ms)), '[]'::jsonb)
                   from (select "domainId" d, count(*) t, count(*) filter (where "status" = 'MASTERED') ms from mine group by 1) g),
      'byCourse', (select coalesce(jsonb_agg(jsonb_build_object('programId', pid, 'code', (select "code" from public."Program" where "id" = pid),
                      'titleAr', (select "titleAr" from public."Program" where "id" = pid), 'titleEn', (select "titleEn" from public."Program" where "id" = pid),
                      'total', t, 'mastered', ms)), '[]'::jsonb)
                   from (select "programId" pid, count(*) t, count(*) filter (where "status" = 'MASTERED') ms from mine group by 1) g),
      'openSession', (select "id" from public."MistakeSession" s where s."memberId" = me."id" and s."status" = 'IN_PROGRESS'
                        and (p_program is null or s."programId" = p_program) order by s."createdAt" desc limit 1))
  );
end $$;

-- One mistake: the question (public view), my last wrong answer, history, and what the source exam lets me see.
-- Opening it counts as "reviewed" for a question not reviewed yet.
create or replace function public.exam_mistake_detail(p_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare me public."ExamMember" := public.exam_current_member(); m public."MistakeItem"; imgs jsonb;
begin
  select * into m from public."MistakeItem" where "id" = p_id;
  if m."id" is null or me."id" is null or m."memberId" <> me."id" or not public.exam_mistake_visible(m."id") then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  perform public.exam_rate_hit('mistakes', 60);
  if m."status" = 'WRONG_NOT_REVIEWED' then
    update public."MistakeItem" set "status" = 'REVIEWED', "lastReviewedAt" = now(), "updatedAt" = now() where "id" = p_id returning * into m;
    insert into public."MistakeHistory" ("mistakeId", "kind") values (p_id, 'VIEWED');
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('path', a."path", 'kind', a."kind", 'captionAr', a."captionAr", 'captionEn', a."captionEn") order by a."sortOrder"), '[]'::jsonb)
    into imgs from public."ExamAsset" a where a."ownerType" = 'QUESTION' and a."ownerId" = m."questionId";
  return public.exam_mistake_summary(m) || jsonb_build_object(
    'data', public.exam_public_question(m."snapshot", false, imgs), 'scenario', public.exam_mistake_scenario(m), 'lastResponse', m."lastResponse",
    'reveal', public.exam_mistake_reveal(m),
    'history', (select coalesce(jsonb_agg(jsonb_build_object('kind', h."kind", 'at', h."createdAt") order by h."createdAt"), '[]'::jsonb)
                from public."MistakeHistory" h where h."mistakeId" = p_id));
end $$;

-- Start (or resume) a review session for one course
create or replace function public.exam_mistakes_start(p_program text, p_filter jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me public."ExamMember" := public.exam_current_member(); f jsonb := coalesce(p_filter, '{}'::jsonb);
  v_open text; v_session text; v_count int; v_minutes int; v_mode text; v_ids text[]; v_statuses text[];
  m public."MistakeItem"; v_pos int := 0; imgs jsonb;
begin
  if me."id" is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  perform public.exam_rate_hit('mistakes_start', 10);
  if public.exam_course_access(p_program) is null then raise exception 'forbidden' using errcode = '42501'; end if;
  select "id" into v_open from public."MistakeSession" where "memberId" = me."id" and "programId" = p_program and "status" = 'IN_PROGRESS' limit 1;
  if v_open is not null then return jsonb_build_object('sessionId', v_open, 'resumed', true); end if;

  v_count := least(greatest(coalesce(nullif(f ->> 'count', '')::int, 20), 1), 100);
  v_minutes := nullif(f ->> 'minutes', '')::int;
  if v_minutes is not null and (v_minutes < 1 or v_minutes > 300) then raise exception 'invalid_mistakes: minutes'; end if;
  v_mode := coalesce(nullif(f ->> 'feedbackMode', ''), 'AFTER_ANSWER');
  if v_mode not in ('AFTER_ANSWER', 'AFTER_SESSION') then raise exception 'invalid_mistakes: feedback_mode'; end if;
  select array_agg(x) into v_ids from jsonb_array_elements_text(coalesce(f -> 'ids', '[]'::jsonb)) x;
  select array_agg(x) into v_statuses from jsonb_array_elements_text(coalesce(f -> 'statuses', '[]'::jsonb)) x;
  if v_statuses is null then v_statuses := array['WRONG_NOT_REVIEWED', 'REVIEWED', 'CORRECT_IN_REVIEW', 'WRONG_AGAIN']; end if;

  insert into public."MistakeSession" ("memberId", "programId", "feedbackMode", "deadlineAt")
  values (me."id", p_program, v_mode, case when v_minutes is not null then now() + make_interval(mins => v_minutes) end)
  returning "id" into v_session;

  for m in
    select * from public."MistakeItem" x
    where x."memberId" = me."id" and x."programId" = p_program and public.exam_mistake_visible(x."id")
      and (v_ids is null or x."id" = any(v_ids))
      and (v_ids is not null or x."status" = any(v_statuses))
      and (nullif(f ->> 'domainId', '') is null or x."domainId" = f ->> 'domainId')
      and (nullif(f ->> 'topicId', '') is null or x."topicId" = f ->> 'topicId')
      and (nullif(f ->> 'difficulty', '') is null or x."difficulty" = f ->> 'difficulty')
      and (nullif(f ->> 'type', '') is null or x."type" = f ->> 'type')
    order by case when coalesce((f ->> 'random')::boolean, true) then random() end, x."lastWrongAt" desc
    limit v_count
  loop
    v_pos := v_pos + 1;
    select coalesce(jsonb_agg(jsonb_build_object('path', a."path", 'kind', a."kind", 'captionAr', a."captionAr", 'captionEn', a."captionEn") order by a."sortOrder"), '[]'::jsonb)
      into imgs from public."ExamAsset" a where a."ownerType" = 'QUESTION' and a."ownerId" = m."questionId";
    insert into public."MistakeSessionQuestion" ("sessionId", "position", "mistakeId", "publicData")
    values (v_session, v_pos, m."id", public.exam_public_question(m."snapshot", true, imgs) || jsonb_build_object('scenario', public.exam_mistake_scenario(m)));
  end loop;
  if v_pos = 0 then raise exception 'no_mistakes' using errcode = 'P0002'; end if;
  update public."MistakeSession" set "questionCount" = v_pos where "id" = v_session;
  return jsonb_build_object('sessionId', v_session, 'resumed', false);
end $$;

-- grade + update statuses and close the session (internal)
create or replace function public.exam_mistakes_finish(p_session text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare s public."MistakeSession"; q public."MistakeSessionQuestion"; m public."MistakeItem"; v_need int := public.exam_mastery_streak(); v_ok int := 0;
begin
  select * into s from public."MistakeSession" where "id" = p_session for update;
  if s."status" <> 'IN_PROGRESS' then return; end if;
  for q in select * from public."MistakeSessionQuestion" where "sessionId" = p_session and "isCorrect" is not null loop
    select * into m from public."MistakeItem" where "id" = q."mistakeId";
    if q."isCorrect" then
      v_ok := v_ok + 1;
      update public."MistakeItem" set "reviewCorrect" = "reviewCorrect" + 1, "correctStreak" = "correctStreak" + 1, "lastReviewedAt" = now(),
        "status" = case when "correctStreak" + 1 >= v_need then 'MASTERED' else 'CORRECT_IN_REVIEW' end,
        "masteredAt" = case when "correctStreak" + 1 >= v_need then coalesce("masteredAt", now()) end, "updatedAt" = now()
      where "id" = m."id" returning * into m;
      insert into public."MistakeHistory" ("mistakeId", "kind", "sessionId", "response") values (m."id", 'REVIEW_CORRECT', p_session, q."response");
      if m."status" = 'MASTERED' and m."masteredAt" >= now() then
        insert into public."MistakeHistory" ("mistakeId", "kind", "sessionId") values (m."id", 'MASTERED', p_session);
      end if;
    else
      if m."status" = 'MASTERED' then insert into public."MistakeHistory" ("mistakeId", "kind", "sessionId") values (m."id", 'REOPENED', p_session); end if;
      update public."MistakeItem" set "reviewWrong" = "reviewWrong" + 1, "correctStreak" = 0, "status" = 'WRONG_AGAIN', "masteredAt" = null,
        "lastReviewedAt" = now(), "updatedAt" = now() where "id" = m."id";
      insert into public."MistakeHistory" ("mistakeId", "kind", "sessionId", "response") values (m."id", 'REVIEW_WRONG', p_session, q."response");
    end if;
  end loop;
  update public."MistakeSession" set "status" = 'COMPLETED', "submittedAt" = now(), "correctCount" = v_ok, "score" = v_ok, "maxScore" = s."questionCount" where "id" = p_session;
end $$;

create or replace function public.exam_own_session(p_session text)
returns public."MistakeSession"
language plpgsql
security definer
set search_path = public
as $$
declare me public."ExamMember" := public.exam_current_member(); s public."MistakeSession";
begin
  select * into s from public."MistakeSession" where "id" = p_session;
  if s."id" is null or me."id" is null or s."memberId" <> me."id" then raise exception 'not_found' using errcode = 'P0002'; end if;
  if s."status" = 'IN_PROGRESS' and s."deadlineAt" is not null and now() > s."deadlineAt" then
    perform public.exam_mistakes_finish(p_session); -- timer over: close with what was answered
    select * into s from public."MistakeSession" where "id" = p_session;
  end if;
  return s;
end $$;

-- Session state; answered questions show the outcome (and, in AFTER_ANSWER mode, what the source exam allows)
create or replace function public.exam_mistakes_state(p_session text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare s public."MistakeSession" := public.exam_own_session(p_session);
begin
  perform public.exam_rate_hit('mistakes', 60);
  return jsonb_build_object(
    'id', s."id", 'programId', s."programId", 'status', s."status", 'feedbackMode', s."feedbackMode", 'serverNow', now(), 'deadlineAt', s."deadlineAt",
    'questionCount', s."questionCount", 'correctCount', s."correctCount", 'score', s."score", 'maxScore', s."maxScore",
    'questions', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', q."id", 'position', q."position", 'data', q."publicData", 'response', q."response", 'isCorrect', q."isCorrect",
        'reveal', case when q."isCorrect" is not null and (s."feedbackMode" = 'AFTER_ANSWER' or s."status" = 'COMPLETED')
                       then (select public.exam_mistake_reveal(m) from public."MistakeItem" m where m."id" = q."mistakeId") end)
        order by q."position"), '[]'::jsonb)
      from public."MistakeSessionQuestion" q where q."sessionId" = p_session));
end $$;

-- Answer one question of the session (one answer per question; graded at once on the server)
create or replace function public.exam_mistakes_answer(p_session text, p_question text, p_response jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare s public."MistakeSession" := public.exam_own_session(p_session); q public."MistakeSessionQuestion"; m public."MistakeItem"; g jsonb;
begin
  perform public.exam_rate_hit('mistakes_answer', 120);
  if s."status" <> 'IN_PROGRESS' then raise exception 'session_closed' using errcode = '42501'; end if;
  select * into q from public."MistakeSessionQuestion" where "id" = p_question and "sessionId" = p_session;
  if q."id" is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  if q."isCorrect" is not null then raise exception 'already_answered' using errcode = '42501'; end if;
  if p_response is null or p_response = 'null'::jsonb or not coalesce(public.exam_response_ok(q."publicData", p_response), false) then
    raise exception 'invalid_response' using errcode = '22023';
  end if;
  select * into m from public."MistakeItem" where "id" = q."mistakeId";
  if m."type" = 'ESSAY' then
    -- essays cannot be auto-graded: answering marks it as reviewed (self-check against the guide if revealed)
    update public."MistakeSessionQuestion" set "response" = p_response, "answeredAt" = now() where "id" = p_question;
    update public."MistakeItem" set "status" = case when "status" = 'WRONG_NOT_REVIEWED' then 'REVIEWED' else "status" end, "lastReviewedAt" = now() where "id" = m."id";
    return jsonb_build_object('isCorrect', null, 'reveal', case when s."feedbackMode" = 'AFTER_ANSWER' then public.exam_mistake_reveal(m) end);
  end if;
  g := public.exam_grade(m."snapshot", p_response, 1);
  update public."MistakeSessionQuestion" set "response" = p_response, "isCorrect" = (g ->> 'correct')::boolean, "answeredAt" = now() where "id" = p_question;
  return jsonb_build_object('isCorrect', (g ->> 'correct')::boolean, 'reveal', case when s."feedbackMode" = 'AFTER_ANSWER' then public.exam_mistake_reveal(m) end);
end $$;

create or replace function public.exam_mistakes_submit(p_session text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare s public."MistakeSession" := public.exam_own_session(p_session);
begin
  if s."status" = 'IN_PROGRESS' then perform public.exam_mistakes_finish(p_session); end if;
  return public.exam_mistakes_state(p_session);
end $$;

-- ── staff ──

create or replace function public.exam_mistakes_report(p_program text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.exam_instructor_can(p_program, 'canViewResults') then raise exception 'forbidden' using errcode = '42501'; end if;
  return jsonb_build_object(
    'masteryStreak', public.exam_mastery_streak(),
    'learners', (select coalesce(jsonb_agg(x order by (x ->> 'total')::int desc), '[]'::jsonb) from (
      select jsonb_build_object('memberId', m."memberId", 'name', e."name", 'email', e."email", 'total', count(*),
        'mastered', count(*) filter (where m."status" = 'MASTERED'),
        'stillWrong', count(*) filter (where m."status" in ('WRONG_AGAIN', 'WRONG_NOT_REVIEWED')),
        'wrongTotal', sum(m."wrongCount"), 'reviewCorrect', sum(m."reviewCorrect"), 'reviewWrong', sum(m."reviewWrong")) x
      from public."MistakeItem" m join public."ExamMember" e on e."id" = m."memberId"
      where m."programId" = p_program group by m."memberId", e."name", e."email") s),
    'questions', (select coalesce(jsonb_agg(x order by (x ->> 'wrongs')::int desc), '[]'::jsonb) from (
      select jsonb_build_object('questionId', m."questionId", 'stemAr', left(max(q."stemAr"), 200), 'stemEn', left(max(q."stemEn"), 200), 'type', max(m."type"),
        'learners', count(*), 'wrongs', sum(m."wrongCount"), 'mastered', count(*) filter (where m."status" = 'MASTERED'),
        'domain', max((select coalesce(nullif(c."nameAr", ''), c."nameEn") from public."QuestionCategory" c where c."id" = m."domainId"))) x
      from public."MistakeItem" m left join public."Question" q on q."id" = m."questionId"
      where m."programId" = p_program group by m."questionId" order by sum(m."wrongCount") desc limit 25) s),
    'domains', (select coalesce(jsonb_agg(x order by (x ->> 'wrongs')::int desc), '[]'::jsonb) from (
      select jsonb_build_object('domainId', m."domainId",
        'name', (select coalesce(nullif(c."nameAr", ''), c."nameEn") from public."QuestionCategory" c where c."id" = m."domainId"),
        'items', count(*), 'wrongs', sum(m."wrongCount"), 'mastered', count(*) filter (where m."status" = 'MASTERED')) x
      from public."MistakeItem" m where m."programId" = p_program group by m."domainId") s),
    'topics', (select coalesce(jsonb_agg(x order by (x ->> 'wrongs')::int desc), '[]'::jsonb) from (
      select jsonb_build_object('topicId', m."topicId",
        'name', (select coalesce(nullif(c."nameAr", ''), c."nameEn") from public."QuestionCategory" c where c."id" = m."topicId"),
        'items', count(*), 'wrongs', sum(m."wrongCount")) x
      from public."MistakeItem" m where m."programId" = p_program and m."topicId" is not null group by m."topicId") s),
    'exams', (select coalesce(jsonb_agg(x order by (x ->> 'items')::int desc), '[]'::jsonb) from (
      select jsonb_build_object('examId', m."lastExamId", 'title', (select coalesce(nullif(e."titleAr", ''), e."titleEn") from public."Exam" e where e."id" = m."lastExamId"),
        'items', count(*)) x
      from public."MistakeItem" m where m."programId" = p_program group by m."lastExamId") s));
end $$;

-- admin: mastery policy (consecutive correct review sessions needed, 1–5)
create or replace function public.exam_admin_set_mastery(p_streak int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare me public."ExamMember" := public.exam_require_admin();
begin
  if p_streak is null or p_streak < 1 or p_streak > 5 then raise exception 'invalid_mistakes: streak'; end if;
  insert into public."Setting" ("key", "value", "updatedAt") values ('examMasteryStreak', p_streak::text, now())
  on conflict ("key") do update set "value" = excluded."value", "updatedAt" = now();
  perform public.exam_log('mistakes.mastery_policy', 'Setting', 'examMasteryStreak', null, jsonb_build_object('streak', p_streak));
  return jsonb_build_object('masteryStreak', p_streak);
end $$;

-- ── access ──
do $$
declare t text;
begin
  foreach t in array array['MistakeItem', 'MistakeHistory', 'MistakeSession', 'MistakeSessionQuestion'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;

revoke all on function public.exam_mastery_streak() from public, anon, authenticated;
revoke all on function public.exam_mistake_reveal(public."MistakeItem") from public, anon, authenticated;
revoke all on function public.exam_mistake_scenario(public."MistakeItem") from public, anon, authenticated;
revoke all on function public.exam_mistake_visible(text) from public, anon, authenticated;
revoke all on function public.exam_mistake_summary(public."MistakeItem") from public, anon, authenticated;
revoke all on function public.exam_collect_mistakes(text) from public, anon, authenticated;
revoke all on function public.exam_mistakes_finish(text) from public, anon, authenticated;
revoke all on function public.exam_own_session(text) from public, anon, authenticated;

revoke all on function public.exam_mistakes_overview(text, jsonb) from public, anon;
revoke all on function public.exam_mistake_detail(text) from public, anon;
revoke all on function public.exam_mistakes_start(text, jsonb) from public, anon;
revoke all on function public.exam_mistakes_state(text) from public, anon;
revoke all on function public.exam_mistakes_answer(text, text, jsonb) from public, anon;
revoke all on function public.exam_mistakes_submit(text) from public, anon;
revoke all on function public.exam_mistakes_report(text) from public, anon;
revoke all on function public.exam_admin_set_mastery(int) from public, anon;

grant execute on function public.exam_mistakes_overview(text, jsonb) to authenticated;
grant execute on function public.exam_mistake_detail(text) to authenticated;
grant execute on function public.exam_mistakes_start(text, jsonb) to authenticated;
grant execute on function public.exam_mistakes_state(text) to authenticated;
grant execute on function public.exam_mistakes_answer(text, text, jsonb) to authenticated;
grant execute on function public.exam_mistakes_submit(text) to authenticated;
grant execute on function public.exam_mistakes_report(text) to authenticated;
grant execute on function public.exam_admin_set_mastery(int) to authenticated;
