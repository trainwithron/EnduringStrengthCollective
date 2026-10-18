-- RELEASE X1 (TWO NARROW READ FUNCTIONS FOR ATHLETES' SCREENS; ADDS ONLY, SAFE BEFORE OR WITH THE CODE): ONE paste. Steps 156 in order, all or nothing.
--
-- Paste this whole file into the Supabase SQL editor and run it once. It replaces the separate precheck and apply files for these steps (they stay as the fallback).
-- Every check from each step's precheck is built in as a guard in front of that step. If any check is false, the run stops with a message that names the step and the
-- failed check, and NOTHING is kept, so a second run after a refusal is safe.
-- WHAT YOU SHOULD SEE: first "Success" for the transaction, then a result table with one row per step and in_place = true on every row.
-- ON ERROR: run   rollback;   once, copy the red text, send it to Spot. Do not run it again.
-- AFTER STEP 156: Nothing changes on screen. Adds two read-only functions (group_member_names, group_position_roster) that only a member of the group can use; the athlete screens that list the group's members (the @mention lists, the position leaderboard, the game stat grid) use them once the Release X1 code is live and fall back to the older read until then.
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

-- ===== Release X1 (two narrow read functions for athletes' screens; adds only, safe before or with the code), step 156: 0404 Release X1: the narrow reads athletes' screens use to see who else is in their group (a name, a photo, a role and a position, nothing else)
do $g156$
declare
  failed text;
begin
  select string_agg(check_name, '; ') into failed from (
    values
      ('0404 is not already applied (the member-names function is not there yet)', to_regprocedure('public.group_member_names(uuid)') is null),
      ('the tables and helper it uses exist', to_regclass('public.group_memberships') is not null and to_regclass('public.profiles') is not null and to_regclass('public.group_positions') is not null and to_regprocedure('public.is_group_member(uuid)') is not null)
  ) as checks(check_name, ok) where not ok;
  if failed is not null then
    raise exception 'Release X1 (two narrow read functions for athletes'' screens; adds only, safe before or with the code), step 156 (0404) cannot run: this step looks already applied, or the database is not in the state it expects. Failed checks: %. NOTHING was changed (the whole bundle is all or nothing). If an earlier step was applied by hand, use the single-step files for the rest, and send Spot this message.', failed;
  end if;
end
$g156$;

-- ====================================================================================================
-- migration 0404_athlete_narrow_reads.sql
-- ====================================================================================================

-- Release X1: the narrow reads an athlete's screens use to see who else is in their group.
--
-- Today any member of a group can read every column of every membership row of that group (client_tier, training_level, private_from_org, membership_type and the rest), though the athlete screens need only a name, a
-- photo, a role and, for a team, a position. These two functions answer exactly that and nothing else, only for a member of the group:
--   group_member_names(group)      who is in the group: id, name, photo, role   (the @mention lists)
--   group_position_roster(group)   the athletes of a team with their position, name and how they share their activity   (the position leaderboard and the game stat grid)
-- The athlete screens are moved onto them in the same release (they fall back to the old read until this is applied). Nothing is restricted yet: that is a separate step (Release X2). Additions only. Re-runnable.
create or replace function public.group_member_names(p_group uuid)
returns table (profile_id uuid, full_name text, avatar_url text, role text)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.is_group_member(p_group) then
    return;
  end if;
  return query
    select m.profile_id, p.full_name, p.avatar_url, m.role::text
    from public.group_memberships m
    join public.profiles p on p.id = m.profile_id
    where m.group_id = p_group;
end;
$$;
revoke execute on function public.group_member_names(uuid) from public, anon;
grant execute on function public.group_member_names(uuid) to authenticated, service_role;

create or replace function public.group_position_roster(p_group uuid)
returns table (profile_id uuid, full_name text, feed_broadcast_level text, position_id uuid, position_name text, position_sort_order int)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.is_group_member(p_group) then
    return;
  end if;
  return query
    select m.profile_id, p.full_name, p.feed_broadcast_level::text, m.position_id, gp.name, gp.sort_order
    from public.group_memberships m
    join public.profiles p on p.id = m.profile_id
    left join public.group_positions gp on gp.id = m.position_id
    where m.group_id = p_group and m.role = 'athlete';
end;
$$;
revoke execute on function public.group_position_roster(uuid) from public, anon;
grant execute on function public.group_position_roster(uuid) to authenticated, service_role;

commit;

-- Read-only result (after the commit): every row must say in_place = true.
select step, what, in_place from (
  select 'step 156 (0404)' as step, '0404 Release X1: the narrow reads athletes'' screens use to see who else is in their group' as what, not ((to_regprocedure('public.group_member_names(uuid)') is null)) as in_place
) as result order by step;
