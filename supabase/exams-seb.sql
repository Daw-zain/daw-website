-- ─────────────────────────────────────────────────────────────────────────────
-- Exam system — Safe Exam Browser (SEB).
-- Applied by `npm run supabase:setup` (safe to run again).
--
--   • When the general switch is on, a trainee can start, see, answer and resume an exam only from SEB opened
--     with this platform's configuration. Course staff (admins and trainers) are not asked.
--   • Each exam asks for SEB unless it was switched off for that exam. The mistakes quiz follows the general
--     switch. Submitting, results and review stay possible in any browser.
--   • Proof (safeexambrowser.org/developer/seb-config-key.html): SEB gives the page
--     SHA256(page address without "#…" + Config Key). The page sends that value and its address in two request
--     headers; the database recomputes it with the keys it knows.
--   • Honest limit: the configuration file is public, so a technically skilled person could compute the value
--     outside SEB. It stops ordinary copying and window switching, not a determined attacker.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.exam_seb_config()
returns public."SebSetting"
language plpgsql
security definer
set search_path = public
as $$
declare s public."SebSetting";
begin
  select * into s from public."SebSetting" where "id" = 'main';
  if s."id" is null then
    insert into public."SebSetting" ("id", "updatedAt") values ('main', now()) on conflict ("id") do nothing;
    select * into s from public."SebSetting" where "id" = 'main';
  end if;
  return s;
end $$;

-- does this request carry a value only SEB with one of our configurations produces?
create or replace function public.exam_seb_proof()
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare s public."SebSetting"; h jsonb; v_hash text; v_url text;
begin
  begin
    h := nullif(current_setting('request.headers', true), '')::jsonb;
  exception when others then
    return false;
  end;
  v_hash := lower(coalesce(h ->> 'x-seb-hash', ''));
  if v_hash !~ '^[0-9a-f]{64}$' then return false; end if;
  select * into s from public."SebSetting" where "id" = 'main';
  if s."id" is null or s."siteUrl" = '' then return false; end if;
  -- inside the app the address changes without a page load: SEB may have signed either address
  foreach v_url in array array[coalesce(h ->> 'x-seb-url', ''), coalesce(h ->> 'x-seb-load-url', '')] loop
    v_url := split_part(v_url, '#', 1);
    if char_length(v_url) <= 2000 and starts_with(v_url, s."siteUrl")
       and exists (select 1 from unnest(s."configKeys") k where encode(sha256(convert_to(v_url || k, 'UTF8')), 'hex') = v_hash) then
      return true;
    end if;
  end loop;
  return false;
end $$;

-- must this member use SEB here? p_exam null = the mistakes quiz of the course
create or replace function public.exam_seb_required(p_program text, p_exam text default null)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select "enabled" from public."SebSetting" where "id" = 'main'), false)
     and coalesce(public.exam_course_access(p_program), 'LEARNER') = 'LEARNER'
     and (p_exam is null or coalesce((select "requireSeb" from public."Exam" where "id" = p_exam), true))
$$;

create or replace function public.exam_seb_guard(p_program text, p_exam text default null)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if public.exam_seb_required(p_program, p_exam) and not public.exam_seb_proof() then
    raise exception 'seb_required' using errcode = '42501';
  end if;
end $$;

-- ── browser-callable ──

-- what the SEB page shows: is the switch on, is this window accepted; the super admin also sees the keys
create or replace function public.exam_seb_status()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare me public."ExamMember" := public.exam_current_member(); s public."SebSetting";
begin
  if me."id" is null then raise exception 'forbidden' using errcode = '42501'; end if;
  perform public.exam_rate_hit('seb_status', 30);
  s := public.exam_seb_config();
  return jsonb_build_object('enabled', s."enabled", 'accepted', public.exam_seb_proof(), 'canManage', me."role" = 'ADMIN',
    'configKeys', case when me."role" = 'ADMIN' then to_jsonb(s."configKeys") end,
    'siteUrl', case when me."role" = 'ADMIN' then s."siteUrl" end);
end $$;

-- super admin: the general switch and the accepted keys
create or replace function public.exam_seb_save(p_data jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare me public."ExamMember" := public.exam_current_member(); s public."SebSetting"; v_keys text[]; v_on boolean;
begin
  if me."id" is null or me."role" <> 'ADMIN' or not me."active" then raise exception 'forbidden' using errcode = '42501'; end if;
  s := public.exam_seb_config();
  v_keys := s."configKeys";
  if p_data ? 'configKeys' then
    select coalesce(array_agg(distinct k), '{}') into v_keys
    from (select lower(trim(x)) k from jsonb_array_elements_text(p_data -> 'configKeys') x) t where k <> '';
    if exists (select 1 from unnest(v_keys) k where k !~ '^[0-9a-f]{64}$') then raise exception 'invalid_seb: key'; end if;
    if cardinality(v_keys) > 10 then raise exception 'invalid_seb: too_many'; end if;
  end if;
  v_on := coalesce((p_data ->> 'enabled')::boolean, s."enabled");
  if v_on and (cardinality(v_keys) = 0 or s."siteUrl" = '') then raise exception 'invalid_seb: no_key'; end if;
  update public."SebSetting" set "enabled" = v_on, "configKeys" = v_keys, "updatedById" = me."id", "updatedAt" = now() where "id" = 'main';
  perform public.exam_log('seb.settings', 'SebSetting', 'main', null, jsonb_build_object('enabled', v_on, 'keys', cardinality(v_keys)));
  return public.exam_seb_status();
end $$;

-- one exam asks for SEB or not (those who may publish exams of the course); allowed while published
create or replace function public.exam_seb_set_exam(p_exam text, p_required boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare e public."Exam";
begin
  select * into e from public."Exam" where "id" = p_exam;
  if e."id" is null or p_required is null or not coalesce(public.exam_instructor_can(e."programId", 'canPublishExams'), false) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  update public."Exam" set "requireSeb" = p_required, "updatedAt" = now() where "id" = p_exam;
  perform public.exam_log('seb.exam', 'Exam', p_exam, e."programId", jsonb_build_object('required', p_required));
  return jsonb_build_object('requireSeb', p_required);
end $$;

revoke all on function public.exam_seb_config() from public, anon, authenticated;
revoke all on function public.exam_seb_proof() from public, anon, authenticated;
revoke all on function public.exam_seb_required(text, text) from public, anon, authenticated;
revoke all on function public.exam_seb_guard(text, text) from public, anon, authenticated;
revoke all on function public.exam_seb_status() from public, anon;
revoke all on function public.exam_seb_save(jsonb) from public, anon;
revoke all on function public.exam_seb_set_exam(text, boolean) from public, anon;
grant execute on function public.exam_seb_status() to authenticated;
grant execute on function public.exam_seb_save(jsonb) to authenticated;
grant execute on function public.exam_seb_set_exam(text, boolean) to authenticated;
