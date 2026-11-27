-- ─────────────────────────────────────────────────────────────────────────────
-- Applied once with the project owner (Supabase connector / SQL editor): the application role does not own
-- these objects. Safe to run again.
-- ─────────────────────────────────────────────────────────────────────────────

-- "rls_auto_enable" is the event trigger that switches row-level security on for every new table. It runs by
-- itself on CREATE TABLE; nobody needs to call it, so browser roles lose the right to.
do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    revoke all on function public.rls_auto_enable() from public, anon, authenticated;
  end if;
end $$;
