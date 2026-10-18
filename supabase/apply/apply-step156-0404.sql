-- STEP 156: 0404 Release X1: the narrow reads athletes' screens use to see who else is in their group (a name, a photo, a role and a position, nothing else)
--
-- Run apply-precheck first (every row ok = true). Then paste THIS file and run it once.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."
-- AFTERWARDS: Nothing changes on screen. Adds two read-only functions (group_member_names, group_position_roster) that only a member of the group can use; the athlete screens that list the group's members (the @mention lists, the position leaderboard, the game stat grid) use them once the Release X1 code is live and fall back to the older read until then.
-- ON ERROR: it is all or nothing, so nothing was applied. Run   rollback;   once, copy the red error text, and send it back. Do not run the file again.
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

do $guard$
begin
  if not ((to_regprocedure('public.group_member_names(uuid)') is null)) then
    raise exception 'Step 156 (0404) looks already applied, or the database is not in the state it expects. Nothing was changed. Run the precheck file and send Spot the result.';
  end if;
end
$guard$;

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
