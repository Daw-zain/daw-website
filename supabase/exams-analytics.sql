-- ─────────────────────────────────────────────────────────────────────────────
-- Exam system · Phase 12 — reports and analytics.
-- Applied by `npm run supabase:setup` after exams-import.sql (safe to run again).
--
--   • Every number comes from real attempts: nothing is stored, estimated or invented.
--   • "Counted" attempts (used for scores) are graded and released to staff statistics:
--     COMPLETED / TIMED_OUT / ABANDONED with no essay waiting for a grade. Attempts in progress,
--     awaiting essay grading, held for review or cancelled are counted separately.
--   • Staff reports need canViewResults on the course. A learner report contains only the caller's
--     own attempts whose results have been released.
-- No new tables.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── helpers ──

-- performance of a set of attempts grouped by domainId | topicId | difficulty | type
create or replace function public.exam_analytics_breakdown(p_ids text[], p_key text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object('key', g.k, 'nameAr', c."nameAr", 'nameEn', c."nameEn", 'questions', g.nq,
      'asked', g.n, 'answered', g.ans, 'correct', g.ok, 'scorePct', g.pct) order by g.pct nulls last, g.n desc), '[]'::jsonb)
  from (
    select case p_key when 'type' then q."type" else q."snapshot" ->> p_key end k,
      count(distinct q."questionId") nq,
      count(*) n,
      count(*) filter (where q."response" is not null and q."response" <> 'null'::jsonb) ans,
      count(*) filter (where q."isCorrect") ok,
      round(100 * sum(coalesce(q."manualScore", q."score", 0)) / nullif(sum(q."points"), 0), 1) pct
    from public."AttemptQuestion" q where q."attemptId" = any(p_ids)
    group by 1) g
  left join public."QuestionCategory" c on c."id" = g.k
$$;

-- attempt ids of one course matching a staff filter {examId, memberId, from, to}
create or replace function public.exam_analytics_ids(p_program text, p_filter jsonb)
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(a."id"), '{}')
  from public."ExamAttempt" a
  where a."programId" = p_program
    and (nullif(p_filter ->> 'examId', '') is null or a."examId" = p_filter ->> 'examId')
    and (nullif(p_filter ->> 'memberId', '') is null or a."memberId" = p_filter ->> 'memberId')
    and (nullif(p_filter ->> 'from', '') is null or a."startedAt" >= (p_filter ->> 'from')::date)
    and (nullif(p_filter ->> 'to', '') is null or a."startedAt" < (p_filter ->> 'to')::date + 1)
$$;

-- the counted attempts among p_ids; p_scope: all | first | last | best (one per learner per exam)
create or replace function public.exam_analytics_counted(p_ids text[], p_scope text)
returns text[]
language plpgsql
stable
security definer
set search_path = public
as $$
declare v text[];
begin
  if p_scope in ('first', 'last', 'best') then
    select coalesce(array_agg(s."id"), '{}') into v from (
      select distinct on (a."memberId", a."examId") a."id"
      from public."ExamAttempt" a
      where a."id" = any(p_ids) and a."status" in ('COMPLETED', 'TIMED_OUT', 'ABANDONED') and not a."needsManual"
      order by a."memberId", a."examId",
        case when p_scope = 'best' then a."percent" end desc nulls last,
        case when p_scope = 'last' then -a."attemptNo" else a."attemptNo" end) s;
  else
    select coalesce(array_agg(a."id"), '{}') into v
    from public."ExamAttempt" a
    where a."id" = any(p_ids) and a."status" in ('COMPLETED', 'TIMED_OUT', 'ABANDONED') and not a."needsManual";
  end if;
  return v;
end $$;

-- ── staff: course report ──

create or replace function public.exam_analytics_course(p_program text, p_filter jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  f jsonb := coalesce(p_filter, '{}'::jsonb);
  v_scope text := coalesce(nullif(f ->> 'scope', ''), 'all');
  v_all text[]; v_base text[]; v_ids text[]; v_open text;
begin
  if not coalesce(public.exam_instructor_can(p_program, 'canViewResults'), false) then raise exception 'forbidden' using errcode = '42501'; end if;
  if v_scope not in ('all', 'first', 'last', 'best') then raise exception 'invalid: scope' using errcode = '22023'; end if;
  perform public.exam_rate_hit('analytics', 60);
  -- close attempts whose time is over, so they are counted correctly
  for v_open in select "id" from public."ExamAttempt" where "programId" = p_program and "status" = 'IN_PROGRESS' loop
    perform public.exam_attempt_enforce_time(v_open);
  end loop;

  v_all := public.exam_analytics_ids(p_program, f);
  v_base := public.exam_analytics_counted(v_all, 'all');
  v_ids := case when v_scope = 'all' then v_base else public.exam_analytics_counted(v_all, v_scope) end;
  if coalesce((f ->> 'export')::boolean, false) then
    perform public.exam_log('analytics.export', 'Program', p_program, p_program, f);
  end if;

  return jsonb_build_object(
    'generatedAt', now(),
    'filter', jsonb_build_object('scope', v_scope, 'examId', f ->> 'examId', 'memberId', f ->> 'memberId', 'from', f ->> 'from', 'to', f ->> 'to'),
    'options', jsonb_build_object(
      'exams', (select coalesce(jsonb_agg(jsonb_build_object('id', e."id", 'titleAr', e."titleAr", 'titleEn', e."titleEn") order by e."createdAt"), '[]'::jsonb)
                from public."Exam" e where e."programId" = p_program and exists (select 1 from public."ExamAttempt" a where a."examId" = e."id")),
      'learners', (select coalesce(jsonb_agg(jsonb_build_object('id', m."id", 'name', m."name", 'email', m."email") order by m."name", m."email"), '[]'::jsonb)
                   from public."ExamMember" m where exists (select 1 from public."ExamAttempt" a where a."memberId" = m."id" and a."programId" = p_program))),

    'summary', (
      select jsonb_build_object(
        'attempts', count(*) filter (where a."status" <> 'CANCELLED'),
        'counted', cardinality(v_ids),
        'inProgress', count(*) filter (where a."status" = 'IN_PROGRESS'),
        'pendingGrading', count(*) filter (where a."status" in ('SUBMITTED', 'TIMED_OUT', 'ABANDONED') and a."needsManual"),
        'underReview', count(*) filter (where a."status" = 'UNDER_REVIEW'),
        'cancelled', count(*) filter (where a."status" = 'CANCELLED'),
        'learners', count(distinct a."memberId") filter (where a."status" <> 'CANCELLED'))
      from public."ExamAttempt" a where a."id" = any(v_all))
      || (
      select jsonb_build_object(
        'avgPercent', round(avg(a."percent"), 1),
        'medianPercent', round((percentile_cont(0.5) within group (order by a."percent"))::numeric, 1),
        'minPercent', min(a."percent"), 'maxPercent', max(a."percent"),
        'passed', count(*) filter (where a."passed"),
        'graded', count(*) filter (where a."passed" is not null),
        'passRate', round(100.0 * count(*) filter (where a."passed") / nullif(count(*) filter (where a."passed" is not null), 0), 1),
        'avgMinutes', round((avg(extract(epoch from (a."submittedAt" - a."startedAt")) / 60) filter (where a."submittedAt" is not null))::numeric, 1))
      from public."ExamAttempt" a where a."id" = any(v_ids)),

    -- 10 score bands: 0–<10 … 90–100
    'distribution', (
      select jsonb_agg(jsonb_build_object('from', b * 10, 'to', b * 10 + 10, 'count',
        (select count(*) from public."ExamAttempt" a where a."id" = any(v_ids) and a."percent" is not null and least(floor(a."percent" / 10), 9) = b)) order by b)
      from generate_series(0, 9) b),

    'trend', (
      with x as (select a."startedAt" s, a."percent" p, a."passed" ok from public."ExamAttempt" a where a."id" = any(v_ids)),
      u as (select case when max(s) - min(s) > interval '62 days' then 'month' else 'day' end unit from x)
      select jsonb_build_object('unit', (select unit from u), 'points', coalesce((
        select jsonb_agg(jsonb_build_object('period', to_char(g.p, 'YYYY-MM-DD'), 'attempts', g.n, 'avgPercent', g.av, 'passRate', g.pr) order by g.p)
        from (select date_trunc((select unit from u), x.s) p, count(*) n, round(avg(x.p), 1) av,
                round(100.0 * count(*) filter (where x.ok) / nullif(count(*) filter (where x.ok is not null), 0), 1) pr
              from x group by 1) g), '[]'::jsonb))),

    'domains', public.exam_analytics_breakdown(v_ids, 'domainId'),
    'topics', public.exam_analytics_breakdown(v_ids, 'topicId'),
    'types', public.exam_analytics_breakdown(v_ids, 'type'),
    'difficulties', public.exam_analytics_breakdown(v_ids, 'difficulty'),

    -- item analysis: facility = average share of the marks earned; discrimination = correlation between
    -- the item score and the score on the REST of the attempt (shown only with 10 or more answers sheets)
    'questions', (
      select coalesce(jsonb_agg(jsonb_build_object('questionId', g."questionId", 'stemAr', left(qq."stemAr", 220), 'stemEn', left(qq."stemEn", 220),
          'type', g.type, 'difficulty', qq."difficulty", 'status', qq."status", 'versions', g.versions,
          'domainAr', c."nameAr", 'domainEn', c."nameEn",
          'asked', g.n, 'answered', g.ans, 'correct', g.ok, 'wrong', g.bad, 'unanswered', g.n - g.ans,
          'facility', g.facility, 'discrimination', case when g.n >= 10 then g.disc end) order by g.facility nulls last, g.n desc), '[]'::jsonb)
      from (
        select q."questionId", max(q."type") type, count(distinct q."questionVersion") versions,
          count(*) n,
          count(*) filter (where q."response" is not null and q."response" <> 'null'::jsonb) ans,
          count(*) filter (where q."isCorrect") ok,
          count(*) filter (where q."isCorrect" = false and q."response" is not null and q."response" <> 'null'::jsonb) bad,
          round(100 * avg(coalesce(q."manualScore", q."score", 0) / nullif(q."points", 0)), 1) facility,
          round((corr(
            (coalesce(q."manualScore", q."score", 0) / nullif(q."points", 0))::float8,
            ((a."score" - coalesce(q."manualScore", q."score", 0)) / nullif(a."maxScore" - q."points", 0))::float8))::numeric, 2) disc,
          (array_agg(q."snapshot" ->> 'domainId' order by a."startedAt" desc))[1] domain
        from public."AttemptQuestion" q join public."ExamAttempt" a on a."id" = q."attemptId"
        where q."attemptId" = any(v_ids)
        group by q."questionId"
        order by 8 nulls last
        limit 1000) g
      join public."Question" qq on qq."id" = g."questionId"
      left join public."QuestionCategory" c on c."id" = g.domain),

    'exams', (
      select coalesce(jsonb_agg(jsonb_build_object('examId', e."id", 'titleAr', e."titleAr", 'titleEn', e."titleEn", 'examType', e."examType",
          'passPercent', e."passPercent", 'attempts', g.total, 'counted', g.n, 'learners', g.learners, 'avgPercent', g.av, 'minPercent', g.mn,
          'maxPercent', g.mx, 'passRate', g.pr, 'avgMinutes', g.mins, 'timedOut', g.timed) order by g.total desc), '[]'::jsonb)
      from (
        select a."examId",
          count(*) filter (where a."status" <> 'CANCELLED') total,
          count(*) filter (where a."id" = any(v_ids)) n,
          count(distinct a."memberId") filter (where a."status" <> 'CANCELLED') learners,
          round(avg(a."percent") filter (where a."id" = any(v_ids)), 1) av,
          min(a."percent") filter (where a."id" = any(v_ids)) mn,
          max(a."percent") filter (where a."id" = any(v_ids)) mx,
          round(100.0 * count(*) filter (where a."id" = any(v_ids) and a."passed")
            / nullif(count(*) filter (where a."id" = any(v_ids) and a."passed" is not null), 0), 1) pr,
          round((avg(extract(epoch from (a."submittedAt" - a."startedAt")) / 60) filter (where a."id" = any(v_ids) and a."submittedAt" is not null))::numeric, 1) mins,
          count(*) filter (where a."status" = 'TIMED_OUT') timed
        from public."ExamAttempt" a where a."id" = any(v_all) group by a."examId") g
      join public."Exam" e on e."id" = g."examId"),

    -- improvement: per learner and exam with two or more counted attempts, last minus first
    'improvement', (
      with p as (
        select a."memberId", a."examId", count(*) n,
          (array_agg(a."percent" order by a."attemptNo"))[1] first_p,
          (array_agg(a."percent" order by a."attemptNo" desc))[1] last_p,
          max(a."percent") best_p
        from public."ExamAttempt" a where a."id" = any(v_base) group by 1, 2 having count(*) >= 2)
      select jsonb_build_object(
        'pairs', count(*), 'improved', count(*) filter (where last_p > first_p), 'declined', count(*) filter (where last_p < first_p),
        'unchanged', count(*) filter (where last_p = first_p), 'avgFirst', round(avg(first_p), 1), 'avgLast', round(avg(last_p), 1),
        'avgChange', round(avg(last_p - first_p), 1),
        'rows', coalesce(jsonb_agg(jsonb_build_object('memberId', p."memberId", 'name', m."name", 'email', m."email", 'examId', p."examId",
          'titleAr', e."titleAr", 'titleEn', e."titleEn", 'attempts', p.n, 'first', p.first_p, 'last', p.last_p, 'best', p.best_p,
          'change', p.last_p - p.first_p) order by p.last_p - p.first_p desc), '[]'::jsonb))
      from p join public."ExamMember" m on m."id" = p."memberId" join public."Exam" e on e."id" = p."examId"),

    'learners', (
      select coalesce(jsonb_agg(jsonb_build_object('memberId', m."id", 'name', m."name", 'email', m."email", 'attempts', g.total, 'counted', g.n,
          'exams', g.exams, 'examsPassed', g.passed, 'avgPercent', g.av, 'bestPercent', g.best, 'lastPercent', g.last_p,
          'lastAt', g.last_at, 'warnings', g.warnings) order by g.av desc nulls last, m."name"), '[]'::jsonb)
      from (
        select a."memberId",
          count(*) filter (where a."status" <> 'CANCELLED') total,
          count(*) filter (where a."id" = any(v_ids)) n,
          count(distinct a."examId") filter (where a."status" <> 'CANCELLED') exams,
          count(distinct a."examId") filter (where a."id" = any(v_base) and a."passed") passed,
          round(avg(a."percent") filter (where a."id" = any(v_ids)), 1) av,
          max(a."percent") filter (where a."id" = any(v_base)) best,
          (array_agg(a."percent" order by a."startedAt" desc, a."attemptNo" desc) filter (where a."id" = any(v_base)))[1] last_p,
          max(a."startedAt") last_at,
          sum(a."warnings") warnings
        from public."ExamAttempt" a where a."id" = any(v_all) group by a."memberId") g
      join public."ExamMember" m on m."id" = g."memberId"),

    'attemptsList', (
      select coalesce(jsonb_agg(x.j order by x.s desc), '[]'::jsonb) from (
        select a."startedAt" s, jsonb_build_object('id', a."id", 'examId', a."examId", 'titleAr', e."titleAr", 'titleEn', e."titleEn",
          'name', m."name", 'email', m."email", 'attemptNo', a."attemptNo", 'status', a."status", 'needsManual', a."needsManual",
          'startedAt', a."startedAt", 'submittedAt', a."submittedAt",
          'minutes', round((extract(epoch from (a."submittedAt" - a."startedAt")) / 60)::numeric, 1),
          'score', a."score", 'maxScore', a."maxScore", 'percent', a."percent", 'passed', a."passed",
          'questions', a."questionCount", 'answered', a."answeredCount", 'unanswered', a."questionCount" - a."answeredCount",
          'flagged', a."flaggedCount", 'correct', a."correctCount",
          -- the attempt's own wrongCount includes blank questions; here "wrong" means answered and wrong
          'wrong', (select count(*) from public."AttemptQuestion" q where q."attemptId" = a."id" and q."isCorrect" = false
                      and q."response" is not null and q."response" <> 'null'::jsonb),
          'warnings', a."warnings",
          'counted', a."id" = any(v_ids)) j
        from public."ExamAttempt" a join public."ExamMember" m on m."id" = a."memberId" join public."Exam" e on e."id" = a."examId"
        where a."id" = any(v_all) order by a."startedAt" desc limit 3000) x),

    -- mistakes quiz of the course (the learner and exam filters apply)
    'mistakes', (
      with mi as (
        select * from public."MistakeItem" m where m."programId" = p_program
          and (nullif(f ->> 'memberId', '') is null or m."memberId" = f ->> 'memberId')
          and (nullif(f ->> 'examId', '') is null or m."lastExamId" = f ->> 'examId'))
      select jsonb_build_object(
        'total', count(*), 'learners', count(distinct "memberId"),
        'mastered', count(*) filter (where "status" = 'MASTERED'),
        'stillWrong', count(*) filter (where "status" in ('WRONG_AGAIN', 'WRONG_NOT_REVIEWED')),
        'inProgress', count(*) filter (where "status" in ('REVIEWED', 'CORRECT_IN_REVIEW')),
        'wrongTotal', coalesce(sum("wrongCount"), 0), 'reviewCorrect', coalesce(sum("reviewCorrect"), 0), 'reviewWrong', coalesce(sum("reviewWrong"), 0),
        'sessions', (select count(*) from public."MistakeSession" s where s."programId" = p_program and s."status" = 'COMPLETED'
                      and (nullif(f ->> 'memberId', '') is null or s."memberId" = f ->> 'memberId')))
      from mi),

    'security', jsonb_build_object(
      'byKind', (select coalesce(jsonb_agg(jsonb_build_object('kind', g."kind", 'events', g.n, 'counted', g.c, 'attempts', g.a) order by g.n desc), '[]'::jsonb)
                 from (select p."kind", count(*) n, count(*) filter (where p."counted") c, count(distinct p."attemptId") a
                       from public."ProctorEvent" p where p."attemptId" = any(v_all) group by p."kind") g),
      'attemptsWithWarnings', (select count(*) from public."ExamAttempt" a where a."id" = any(v_all) and a."warnings" > 0),
      'events', (select coalesce(jsonb_agg(x.j order by x.s desc), '[]'::jsonb) from (
        select p."createdAt" s, jsonb_build_object('at', p."createdAt", 'kind', p."kind", 'counted', p."counted", 'detail', p."detail",
          'attemptId', a."id", 'name', m."name", 'email', m."email", 'titleAr', e."titleAr", 'titleEn', e."titleEn") j
        from public."ProctorEvent" p
        join public."ExamAttempt" a on a."id" = p."attemptId"
        join public."ExamMember" m on m."id" = a."memberId"
        join public."Exam" e on e."id" = a."examId"
        where p."attemptId" = any(v_all) order by p."createdAt" desc limit 1000) x)));
end $$;

-- staff: how one question was answered (distribution of choices, frequent typed answers)
create or replace function public.exam_analytics_question(p_program text, p_question text, p_filter jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  f jsonb := coalesce(p_filter, '{}'::jsonb);
  v_ids text[]; v_snap jsonb; t text;
begin
  if not coalesce(public.exam_instructor_can(p_program, 'canViewResults'), false) then raise exception 'forbidden' using errcode = '42501'; end if;
  perform public.exam_rate_hit('analytics', 60);
  v_ids := public.exam_analytics_counted(public.exam_analytics_ids(p_program, f), coalesce(nullif(f ->> 'scope', ''), 'all'));
  -- the latest version that learners actually saw
  select q."snapshot" into v_snap from public."AttemptQuestion" q
  where q."attemptId" = any(v_ids) and q."questionId" = p_question order by q."questionVersion" desc limit 1;
  if v_snap is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  t := v_snap ->> 'type';

  return jsonb_build_object(
    'questionId', p_question, 'type', t, 'version', v_snap -> 'version',
    'stemAr', v_snap ->> 'stemAr', 'stemEn', v_snap ->> 'stemEn',
    'asked', (select count(*) from public."AttemptQuestion" q where q."attemptId" = any(v_ids) and q."questionId" = p_question),
    'results', (
      select jsonb_build_object(
        'full', count(*) filter (where coalesce(q."manualScore", q."score", 0) >= q."points"),
        'partial', count(*) filter (where coalesce(q."manualScore", q."score", 0) > 0 and coalesce(q."manualScore", q."score", 0) < q."points"),
        'zero', count(*) filter (where coalesce(q."manualScore", q."score", 0) = 0 and q."response" is not null and q."response" <> 'null'::jsonb),
        'unanswered', count(*) filter (where q."response" is null or q."response" = 'null'::jsonb))
      from public."AttemptQuestion" q where q."attemptId" = any(v_ids) and q."questionId" = p_question),
    -- choice questions: how many picked each option
    'options', case
      when t in ('MCQ', 'MULTI') then (
        select jsonb_agg(jsonb_build_object('id', o ->> 'id', 'textAr', o ->> 'textAr', 'textEn', o ->> 'textEn',
          'correct', coalesce((v_snap -> 'answer' -> 'correct') ? (o ->> 'id'), false),
          'count', (select count(*) from public."AttemptQuestion" q where q."attemptId" = any(v_ids) and q."questionId" = p_question
                    and case when t = 'MCQ' then q."response" ->> 'choice' = o ->> 'id'
                             else coalesce((q."response" -> 'choices') ? (o ->> 'id'), false) end)) order by n)
        from jsonb_array_elements(v_snap -> 'content' -> 'options') with ordinality x(o, n))
      when t = 'TRUE_FALSE' then (
        select jsonb_agg(jsonb_build_object('id', b::text, 'correct', v_snap -> 'answer' -> 'value' = to_jsonb(b),
          'count', (select count(*) from public."AttemptQuestion" q where q."attemptId" = any(v_ids) and q."questionId" = p_question
                    and q."response" -> 'value' = to_jsonb(b))) order by b desc)
        from (values (true), (false)) v(b)) end,
    -- typed answers: the most frequent ones
    'answers', case when t in ('SHORT', 'NUMERIC') then (
      select coalesce(jsonb_agg(jsonb_build_object('text', g.txt, 'count', g.n, 'correct', g.ok) order by g.n desc, g.txt), '[]'::jsonb) from (
        select coalesce(q."response" ->> 'text', q."response" ->> 'value') txt, count(*) n, bool_or(coalesce(q."isCorrect", false)) ok
        from public."AttemptQuestion" q
        where q."attemptId" = any(v_ids) and q."questionId" = p_question and q."response" is not null and q."response" <> 'null'::jsonb
        group by 1 order by count(*) desc limit 15) g) end);
end $$;

-- ── learner: my own performance (released results only) ──

create or replace function public.exam_analytics_me(p_program text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me public."ExamMember" := public.exam_current_member();
  v_all text[]; v_shown text[]; v_open text;
begin
  if me."id" is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  perform public.exam_rate_hit('analytics', 60);
  for v_open in select "id" from public."ExamAttempt" where "memberId" = me."id" and "status" = 'IN_PROGRESS' loop
    perform public.exam_attempt_enforce_time(v_open);
  end loop;
  select coalesce(array_agg(a."id"), '{}') into v_all from public."ExamAttempt" a
  where a."memberId" = me."id" and a."status" <> 'CANCELLED' and (p_program is null or a."programId" = p_program);
  select coalesce(array_agg(a."id"), '{}') into v_shown from public."ExamAttempt" a
  where a."id" = any(v_all) and a."status" in ('COMPLETED', 'TIMED_OUT', 'ABANDONED') and not a."needsManual" and public.exam_results_visible(a);

  return jsonb_build_object(
    'summary', (
      select jsonb_build_object('attempts', cardinality(v_all), 'released', cardinality(v_shown),
        'waiting', cardinality(v_all) - cardinality(v_shown),
        'avgPercent', round(avg(a."percent"), 1), 'bestPercent', max(a."percent"),
        'passed', count(*) filter (where a."passed"), 'graded', count(*) filter (where a."passed" is not null),
        'exams', count(distinct a."examId"), 'examsPassed', count(distinct a."examId") filter (where a."passed"))
      from public."ExamAttempt" a where a."id" = any(v_shown)),
    'exams', (
      select coalesce(jsonb_agg(jsonb_build_object('examId', e."id", 'titleAr', e."titleAr", 'titleEn', e."titleEn", 'programId', e."programId",
          'passPercent', e."passPercent", 'first', g.first_p, 'last', g.last_p, 'best', g.best_p, 'passed', g.ok,
          'change', case when g.n >= 2 then g.last_p - g.first_p end, 'attempts', g.list) order by g.last_at desc), '[]'::jsonb)
      from (
        select a."examId", count(*) n, bool_or(coalesce(a."passed", false)) ok, max(a."startedAt") last_at,
          (array_agg(a."percent" order by a."attemptNo"))[1] first_p,
          (array_agg(a."percent" order by a."attemptNo" desc))[1] last_p,
          max(a."percent") best_p,
          jsonb_agg(jsonb_build_object('id', a."id", 'attemptNo', a."attemptNo", 'percent', a."percent", 'passed', a."passed", 'at', a."startedAt") order by a."attemptNo") list
        from public."ExamAttempt" a where a."id" = any(v_shown) group by a."examId") g
      join public."Exam" e on e."id" = g."examId"),
    'domains', public.exam_analytics_breakdown(v_shown, 'domainId'),
    'topics', public.exam_analytics_breakdown(v_shown, 'topicId'),
    'types', public.exam_analytics_breakdown(v_shown, 'type'),
    'difficulties', public.exam_analytics_breakdown(v_shown, 'difficulty'),
    'mistakes', (
      select jsonb_build_object('total', count(*), 'mastered', count(*) filter (where m."status" = 'MASTERED'),
        'stillWrong', count(*) filter (where m."status" in ('WRONG_AGAIN', 'WRONG_NOT_REVIEWED')),
        'reviewCorrect', coalesce(sum(m."reviewCorrect"), 0), 'reviewWrong', coalesce(sum(m."reviewWrong"), 0))
      from public."MistakeItem" m
      where m."memberId" = me."id" and (p_program is null or m."programId" = p_program) and public.exam_mistake_visible(m."id")));
end $$;

-- ── access ──
revoke all on function public.exam_analytics_breakdown(text[], text) from public, anon, authenticated;
revoke all on function public.exam_analytics_ids(text, jsonb) from public, anon, authenticated;
revoke all on function public.exam_analytics_counted(text[], text) from public, anon, authenticated;

revoke all on function public.exam_analytics_course(text, jsonb) from public, anon;
revoke all on function public.exam_analytics_question(text, text, jsonb) from public, anon;
revoke all on function public.exam_analytics_me(text) from public, anon;

grant execute on function public.exam_analytics_course(text, jsonb) to authenticated;
grant execute on function public.exam_analytics_question(text, text, jsonb) to authenticated;
grant execute on function public.exam_analytics_me(text) to authenticated;
