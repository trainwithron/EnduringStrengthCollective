-- SPEED B (THE READ POLICIES ASK MEMBER / COACH / OWNER OR ADMIN FROM THREE SETS ONCE PER QUERY: THREE FUNCTIONS, 15 READ POLICIES REWRITTEN IN PLACE): ONE paste. Steps 179 in order, all or nothing.
--
-- Paste this whole file into the Supabase SQL editor and run it once. It replaces the separate precheck and apply files for these steps (they stay as the fallback).
-- Every check from each step's precheck is built in as a guard in front of that step. If any check is false, the run stops with a message that names the step and the
-- failed check, and NOTHING is kept, so a second run after a refusal is safe.
-- WHAT YOU SHOULD SEE: first "Success" for the transaction, then a result table with one row per step and in_place = true on every row.
-- ON ERROR: run   rollback;   once, copy the red text, send it to Spot. Do not run it again.
-- AFTER STEP 179: Nothing looks different; Programs, the program charts and Home answer faster. No code change goes with it.
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

-- ===== SPEED B (the read policies ask member / coach / owner or admin from three sets once per query: three functions, 15 read policies rewritten in place), step 179: 0427 SPEED B: the read policies on the ten busiest tables ask 'member / coach / owner or admin of this group' from three sets once per query (three new functions; 15 read policies rewritten in place)
do $g179$
declare
  failed text;
begin
  select string_agg(check_name, '; ') into failed from (
    values
      ('0427 is not already applied (the member set is not there yet)', not (to_regprocedure('public.my_group_ids()') is not null)),
      ('the 15 read policies are exactly the texts this rewrites', (select md5(string_agg(tablename || '|' || policyname || '|' || cmd || '|' || coalesce(qual, '') || '|' || coalesce(with_check, ''), chr(10) order by tablename, policyname)) from pg_policies where schemaname = 'public' and tablename in ('programs','workouts','group_workout_exercises','group_workout_exercise_sets','athlete_sessions','session_exercises','set_logs','group_memberships','groups','workout_logs') and cmd in ('SELECT', 'ALL') and policyname <> 'org_wall_header' and (coalesce(qual, '') ~ '\m(is_group_member|is_group_coach|is_org_admin_of_group)\(' or coalesce(with_check, '') ~ '\m(is_group_member|is_group_coach|is_org_admin_of_group)\(')) = '66584b2355b8f2cc0413bc374c52a413'),
      ('is_group_member is exactly the text the member set matches', coalesce((select md5(replace(pg_get_functiondef(p.oid), chr(13), '')) = '4883c4ef8376c3d48bcfd5e2f20d3814' from pg_proc p where p.oid = to_regprocedure('public.is_group_member(uuid)')), false)),
      ('is_group_coach is exactly the text the coach set matches', coalesce((select md5(replace(pg_get_functiondef(p.oid), chr(13), '')) = 'efa2e330be5434af47ce88d3be81d5d4' from pg_proc p where p.oid = to_regprocedure('public.is_group_coach(uuid)')), false)),
      ('is_org_admin_of_group is exactly the text the owner/admin set matches', coalesce((select md5(replace(pg_get_functiondef(p.oid), chr(13), '')) = '142a65df511b5db2c3c328ffeec3d2dc' from pg_proc p where p.oid = to_regprocedure('public.is_org_admin_of_group(uuid)')), false))
  ) as checks(check_name, ok) where not ok;
  if failed is not null then
    raise exception 'SPEED B (the read policies ask member / coach / owner or admin from three sets once per query: three functions, 15 read policies rewritten in place), step 179 (0427) cannot run: this step looks already applied, or the database is not in the state it expects. Failed checks: %. NOTHING was changed (the whole bundle is all or nothing). If an earlier step was applied by hand, use the single-step files for the rest, and send Spot this message.', failed;
  end if;
end
$g179$;

-- ====================================================================================================
-- migration 0427_member_checks_set_based.sql
-- ====================================================================================================

-- SPEED migration B: the read policies on the ten busiest tables asked is_group_member / is_group_coach / is_org_admin_of_group once PER ROW (each a security-definer lookup; the same 3,023 exercise
-- rows: 1,660 ms per row vs 10 ms as a set). They now read three sets ONCE per query:
--   my_group_ids()          every group the signed-in person has a seat in            (is_group_member(x)       <=> x in my_group_ids())
--   my_coached_group_ids()  every group they are a coach in                            (is_group_coach(x)        <=> x in my_coached_group_ids())
--   my_admin_group_ids()    every group of an organization they own or administer      (is_org_admin_of_group(x) <=> x in my_admin_group_ids())
-- Each set is exactly the rows the per-row function looks for, for the caller (auth.uid()), so every policy means what it meant. is_client_private_from_org, is_workout_visible_to_athlete and every
-- other check are left exactly as they are. Only the 15 SELECT policies named below are rewritten, by replacing those three calls word for word; nothing else in their text changes.
-- (A null group: the per-row function said false and "null in (...)" says null; in a policy both mean "not this row", and none of these calls is under a NOT.)
create or replace function public.my_group_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select gm.group_id from public.group_memberships gm where gm.profile_id = auth.uid()
$$;

create or replace function public.my_coached_group_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select gm.group_id from public.group_memberships gm where gm.profile_id = auth.uid() and gm.role = 'coach'
$$;

create or replace function public.my_admin_group_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select g.id from public.groups g join public.organization_memberships om on om.organization_id = g.organization_id
  where om.profile_id = auth.uid() and om.role in ('owner', 'admin')
$$;

revoke execute on function public.my_group_ids() from public, anon;
revoke execute on function public.my_coached_group_ids() from public, anon;
revoke execute on function public.my_admin_group_ids() from public, anon;
grant execute on function public.my_group_ids() to authenticated, service_role;
grant execute on function public.my_coached_group_ids() to authenticated, service_role;
grant execute on function public.my_admin_group_ids() to authenticated, service_role;

-- The rewrite: is_group_member(<col>) -> (<col> IN ( SELECT public.my_group_ids())), and the same for the other two. <col> is a plain column (group_id, id, g.group_id, s.group_id).
create or replace function public._speed_b_rewrite(q text)
returns text
language sql
immutable
set search_path = public
as $$
  select regexp_replace(
           regexp_replace(
             regexp_replace(q, '\mis_group_member\(([a-z_]+(\.[a-z_]+)?)\)', '(\1 IN ( SELECT public.my_group_ids()))', 'g'),
             '\mis_group_coach\(([a-z_]+(\.[a-z_]+)?)\)', '(\1 IN ( SELECT public.my_coached_group_ids()))', 'g'),
           '\mis_org_admin_of_group\(([a-z_]+(\.[a-z_]+)?)\)', '(\1 IN ( SELECT public.my_admin_group_ids()))', 'g')
$$;

do $$
declare
  r record;
begin
  for r in
    select tablename, policyname, qual from pg_policies
    where schemaname = 'public'
      and (tablename, policyname) in (
        ('athlete_sessions', 'sessions_select_own_or_coach'),
        ('group_memberships', 'group_memberships_select_narrow'),
        ('group_memberships', 'group_memberships_select_org_owner'),
        ('group_memberships', 'memberships_select_same_group'),
        ('group_workout_exercise_sets', 'gwes_select_members'),
        ('group_workout_exercises', 'gwe_select_members'),
        ('groups', 'groups_select_members_or_org_admin'),
        ('programs', 'programs_select_members'),
        ('programs', 'programs_select_org_owner'),
        ('session_exercises', 'session_exercises_select_own_or_coach'),
        ('set_logs', 'set_logs_select_own_or_coach'),
        ('workout_logs', 'workout_logs_select_members'),
        ('workout_logs', 'workout_logs_select_org_owner'),
        ('workouts', 'workouts_select_members'),
        ('workouts', 'workouts_select_org_owner')
      )
      and cmd = 'SELECT'
  loop
    execute format('alter policy %I on public.%I using (%s)', r.policyname, r.tablename, public._speed_b_rewrite(r.qual));
  end loop;
end $$;

drop function public._speed_b_rewrite(text);

commit;

-- Read-only result (after the commit): every row must say in_place = true.
select step, what, in_place from (
  select 'step 179 (0427)' as step, '0427 SPEED B: the read policies on the ten busiest tables ask ''member / coach / owner or admin of this group'' from three sets once per query' as what, not ((not (to_regprocedure('public.my_group_ids()') is not null))) as in_place
) as result order by step;
