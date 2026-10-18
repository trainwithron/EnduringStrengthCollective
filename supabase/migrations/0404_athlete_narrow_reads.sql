-- Release X1: the narrow reads an athlete's screens use to see who else is in their group.
--
-- An owner or admin of the group's organization who holds no seat in the group can use them too (as the existing policy lets them read the rows today), with the same rule that keeps a client who is private
-- from the organization out of sight.
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
declare
  v_member boolean;
begin
  if auth.uid() is null then
    return;
  end if;
  v_member := public.is_group_member(p_group);
  if not v_member and not public.is_org_admin_of_group(p_group) then
    return;
  end if;
  return query
    select m.profile_id, p.full_name, p.avatar_url, m.role::text
    from public.group_memberships m
    join public.profiles p on p.id = m.profile_id
    where m.group_id = p_group
      and (v_member or m.role <> 'athlete' or not public.is_client_private_from_org(m.group_id, m.profile_id));
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
declare
  v_member boolean;
begin
  if auth.uid() is null then
    return;
  end if;
  v_member := public.is_group_member(p_group);
  if not v_member and not public.is_org_admin_of_group(p_group) then
    return;
  end if;
  return query
    select m.profile_id, p.full_name, p.feed_broadcast_level::text, m.position_id, gp.name, gp.sort_order
    from public.group_memberships m
    join public.profiles p on p.id = m.profile_id
    left join public.group_positions gp on gp.id = m.position_id
    where m.group_id = p_group and m.role = 'athlete'
      and (v_member or not public.is_client_private_from_org(m.group_id, m.profile_id));
end;
$$;
revoke execute on function public.group_position_roster(uuid) from public, anon;
grant execute on function public.group_position_roster(uuid) to authenticated, service_role;
