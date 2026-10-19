-- STEP 179: 0427 SPEED B: the read policies on the ten busiest tables ask 'member / coach / owner or admin of this group' from three sets once per query (three new functions; 15 read policies rewritten in place)
--
-- !! This adds three functions (my_group_ids, my_coached_group_ids, my_admin_group_ids) and rewrites 15 read policies in place, replacing is_group_member(x), is_group_coach(x) and is_org_admin_of_group(x) word for word with x in the matching set. Nothing else in their text changes; is_client_private_from_org and every other check stay. The paste checks that the 15 policies and the three per-row functions are exactly the texts this matches, and stops if not.
--
-- Run apply-precheck first (every row ok = true). Then paste THIS file and run it once.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."
-- AFTERWARDS: Nothing looks different; Programs, the program charts and Home answer faster. No code change goes with it.
-- ON ERROR: it is all or nothing, so nothing was applied. Run   rollback;   once, copy the red error text, and send it back. Do not run the file again.
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

do $guard$
begin
  if not ((not (to_regprocedure('public.my_group_ids()') is not null))) then
    raise exception 'Step 179 (0427) looks already applied, or the database is not in the state it expects. Nothing was changed. Run the precheck file and send Spot the result.';
  end if;
end
$guard$;

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
