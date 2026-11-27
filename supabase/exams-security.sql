-- ─────────────────────────────────────────────────────────────────────────────
-- Exam system · Phase 8 — proctoring events, warnings policy, rate limiting, security log.
-- Applied by `npm run supabase:setup` last (safe to run again).
--
-- Honest limits (also in docs/exam-system/09-phase8-report.md): a normal web browser cannot fully stop
-- screenshots, phone cameras or a second device. The real protection is that answers / feedback /
-- explanations are never sent during an attempt, permissions are enforced in the database, abnormal
-- request rates are refused, and suspicious behaviour is recorded for staff.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── rate limiting: max p_limit calls per minute per member and scope ──
create or replace function public.exam_rate_hit(p_scope text, p_limit int)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me public."ExamMember" := public.exam_current_member();
  v_key text := p_scope || ':' || coalesce(me."id", 'anon:' || coalesce(public.exam_jwt_claim('sub'), '?'));
  v_count int; v_flagged timestamptz;
begin
  insert into public."ExamRateLimit" ("key", "windowStart", "count") values (v_key, now(), 1)
  on conflict ("key") do update set
    "count" = case when "ExamRateLimit"."windowStart" < now() - interval '1 minute' then 1 else "ExamRateLimit"."count" + 1 end,
    "windowStart" = case when "ExamRateLimit"."windowStart" < now() - interval '1 minute' then now() else "ExamRateLimit"."windowStart" end
  returning "count", "flaggedAt" into v_count, v_flagged;

  if v_count > p_limit then
    -- First call over the limit: record + alert the admin, and let this one call through — raising here
    -- would roll back the log entry and the notification together with everything else (found by the tests).
    -- Every further call in the window is refused. Alerts at most once per member/scope per 10 minutes.
    if v_flagged is null or v_flagged < now() - interval '10 minutes' then
      update public."ExamRateLimit" set "flaggedAt" = now() where "key" = v_key;
      insert into public."ExamAuditLog" ("actorId", "action", "entity", "details")
      values (me."id", 'security.rate_limit', p_scope, jsonb_build_object('count', v_count, 'limit', p_limit, 'email', me."email"));
      insert into public."Notification" ("id", "type", "title", "body", "link")
      values (gen_random_uuid()::text, 'exam_security', 'نشاط غير طبيعي في منصة الاختبارات',
        'تجاوز ' || coalesce(me."email", 'مستخدم') || ' الحد المسموح من الطلبات (' || p_scope || ': ' || v_count || ' في الدقيقة).', '/ar/exams/admin');
      return;
    end if;
    raise exception 'rate_limited' using errcode = '54000';
  end if;
end $$;

-- ── browser-behaviour event during an own attempt ──
-- Returns {warnings, maxWarnings, action: none | warn | submitted | review, counted}
create or replace function public.exam_attempt_event(p_attempt text, p_kind text, p_detail text default '')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  a public."ExamAttempt" := public.exam_own_attempt(p_attempt);
  sec jsonb; v_counts boolean; v_max int; v_on text; v_recent boolean; v_action text := 'none';
begin
  perform public.exam_rate_hit('attempt_event', 60);
  if p_kind not in ('HIDDEN', 'BLUR', 'FULLSCREEN_EXIT', 'COPY', 'PASTE', 'CONTEXT_MENU', 'PRINT', 'SHORTCUT') then
    raise exception 'invalid_event' using errcode = '22023';
  end if;
  perform public.exam_attempt_enforce_time(p_attempt);
  select * into a from public."ExamAttempt" where "id" = p_attempt;
  if a."status" <> 'IN_PROGRESS' then
    return jsonb_build_object('warnings', a."warnings", 'action', 'closed', 'counted', false);
  end if;

  sec := coalesce(a."settings" -> 'security', '{}'::jsonb);
  v_max := coalesce((sec ->> 'maxWarnings')::int, 3);
  v_on := coalesce(sec ->> 'onExceed', 'WARN');
  -- only leaving the exam counts as a warning (when monitoring is on); copy/paste attempts are logged
  v_counts := (p_kind in ('HIDDEN', 'BLUR') and coalesce((sec ->> 'detectBlur')::boolean, true))
           or (p_kind = 'FULLSCREEN_EXIT' and coalesce((sec ->> 'fullscreen')::boolean, false));
  -- one "leave" = one warning: HIDDEN + BLUR + FULLSCREEN_EXIT fired together within 3 s count once
  if v_counts then
    v_recent := exists (select 1 from public."ProctorEvent" where "attemptId" = p_attempt and "counted"
                          and "createdAt" > now() - interval '3 seconds');
    if v_recent then v_counts := false; end if;
  end if;

  insert into public."ProctorEvent" ("attemptId", "memberId", "programId", "kind", "counted", "detail")
  values (p_attempt, a."memberId", a."programId", p_kind, v_counts, left(coalesce(p_detail, ''), 200));

  if v_counts then
    update public."ExamAttempt" set "warnings" = "warnings" + 1, "lastSeenAt" = now() where "id" = p_attempt returning * into a;
    if v_max > 0 and a."warnings" > v_max then
      if v_on = 'SUBMIT' then
        perform public.exam_log('security.auto_submit', 'ExamAttempt', p_attempt, a."programId", jsonb_build_object('warnings', a."warnings"));
        perform public.exam_attempt_finalize(p_attempt, 'COMPLETED');
        v_action := 'submitted';
      elsif v_on = 'REVIEW' then
        if not a."reviewFlag" then
          update public."ExamAttempt" set "reviewFlag" = true where "id" = p_attempt;
          perform public.exam_log('security.review_flag', 'ExamAttempt', p_attempt, a."programId", jsonb_build_object('warnings', a."warnings"));
        end if;
        v_action := 'review';
      else
        v_action := 'warn';
      end if;
    else
      v_action := 'warn';
    end if;
  end if;
  return jsonb_build_object('warnings', a."warnings", 'maxWarnings', v_max, 'action', v_action, 'counted', v_counts);
end $$;

-- ── staff ──

-- events of one attempt (needs canViewResults on its course)
create or replace function public.exam_attempt_events(p_attempt text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare a public."ExamAttempt";
begin
  select * into a from public."ExamAttempt" where "id" = p_attempt;
  if a."id" is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  if not public.exam_instructor_can(a."programId", 'canViewResults') then raise exception 'forbidden' using errcode = '42501'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('kind', e."kind", 'counted', e."counted", 'detail', e."detail", 'at', e."createdAt") order by e."createdAt"), '[]'::jsonb)
          from public."ProctorEvent" e where e."attemptId" = p_attempt);
end $$;

-- release an attempt held for review (its result becomes visible according to the exam policy)
create or replace function public.exam_attempt_clear_review(p_attempt text, p_note text default '')
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
  if a."status" <> 'UNDER_REVIEW' then raise exception 'invalid_grade: status'; end if;
  update public."ExamAttempt" set "reviewFlag" = false, "status" = 'SUBMITTED', "staffNote" = left(coalesce(p_note, ''), 2000), "updatedAt" = now() where "id" = p_attempt;
  perform public.exam_attempt_recalc(p_attempt); -- SUBMITTED → COMPLETED when nothing needs manual grading
  perform public.exam_log('security.review_cleared', 'ExamAttempt', p_attempt, a."programId", jsonb_build_object('note', p_note));
  return public.exam_attempt_detail(p_attempt);
end $$;

-- security log: admins see everything, instructors (canViewResults) see their courses
create or replace function public.exam_security_log(p_limit int default 100)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare me public."ExamMember" := public.exam_current_member(); v_admin boolean;
begin
  if me."id" is null then raise exception 'forbidden' using errcode = '42501'; end if;
  v_admin := public.exam_can('audit', 'read');
  if not v_admin and not exists (select 1 from public."CourseInstructor" where "memberId" = me."id" and "canViewResults" and me."role" <> 'LEARNER') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'events', (select coalesce(jsonb_agg(x order by x ->> 'at' desc), '[]'::jsonb) from (
      select jsonb_build_object('at', l."createdAt", 'action', l."action", 'entity', l."entity", 'entityId', l."entityId",
        'programId', l."programId", 'details', l."details", 'actor', m."email",
        'course', (select coalesce(p."code", p."titleAr") from public."Program" p where p."id" = l."programId")) x
      from public."ExamAuditLog" l left join public."ExamMember" m on m."id" = l."actorId"
      where l."action" like 'security.%'
        and (v_admin or l."programId" in (select "programId" from public."CourseInstructor" where "memberId" = me."id" and "canViewResults" and me."role" <> 'LEARNER'))
      order by l."createdAt" desc limit least(greatest(coalesce(p_limit, 100), 1), 500)) s),
    'attempts', (select coalesce(jsonb_agg(x order by (x ->> 'warnings')::int desc), '[]'::jsonb) from (
      select jsonb_build_object('attemptId', a."id", 'examId', a."examId", 'warnings', a."warnings", 'status', a."status",
        'reviewFlag', a."reviewFlag", 'email', m."email", 'name', m."name", 'startedAt', a."startedAt",
        'exam', (select coalesce(nullif(e."titleAr", ''), e."titleEn") from public."Exam" e where e."id" = a."examId"),
        'course', (select coalesce(p."code", p."titleAr") from public."Program" p where p."id" = a."programId")) x
      from public."ExamAttempt" a join public."ExamMember" m on m."id" = a."memberId"
      where (a."warnings" > 0 or a."reviewFlag")
        and (v_admin or a."programId" in (select "programId" from public."CourseInstructor" where "memberId" = me."id" and "canViewResults" and me."role" <> 'LEARNER'))
      order by a."warnings" desc limit 100) s));
end $$;

-- ── access ──
do $$
declare t text;
begin
  foreach t in array array['ProctorEvent', 'ExamRateLimit'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;

revoke all on function public.exam_rate_hit(text, int) from public, anon, authenticated;

revoke all on function public.exam_attempt_event(text, text, text) from public, anon;
revoke all on function public.exam_attempt_events(text) from public, anon;
revoke all on function public.exam_attempt_clear_review(text, text) from public, anon;
revoke all on function public.exam_security_log(int) from public, anon;

grant execute on function public.exam_attempt_event(text, text, text) to authenticated;
grant execute on function public.exam_attempt_events(text) to authenticated;
grant execute on function public.exam_attempt_clear_review(text, text) to authenticated;
grant execute on function public.exam_security_log(int) to authenticated;
