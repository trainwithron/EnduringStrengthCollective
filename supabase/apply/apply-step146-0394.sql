-- STEP 146: 0394 Release J: a new season for a team (the old group is retired and kept whole; the new one has the same positions, coaches and the athletes chosen)
--
-- Run apply-precheck first (every row ok = true). Then paste THIS file and run it once.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."
-- AFTERWARDS: Nothing changes on screen until the Release J code is live. Adds one empty column (when a group was retired) and two functions (start next season, bring a retired season back). Safe to run before the code is live.
-- ON ERROR: it is all or nothing, so nothing was applied. Run   rollback;   once, copy the red error text, and send it back. Do not run the file again.
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

do $guard$
begin
  if not ((not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'groups' and column_name = 'archived_at'))) then
    raise exception 'Step 146 (0394) looks already applied, or the database is not in the state it expects. Nothing was changed. Run the precheck file and send Spot the result.';
  end if;
end
$guard$;

-- ====================================================================================================
-- migration 0394_team_seasons.sql
-- ====================================================================================================

-- 0394: a new season for a team. Until now a coach could not retire last season's roster: the old group stayed in every list forever, and the new season meant building the group, its positions and its roster again
-- by hand. This adds:
--   groups.archived_at           a retired group. Its records are untouched (a group's history is filed by the group); it is only left out of the coach's lists and of where people land. A coach can still open it.
--   start_new_season(group, name, athletes)   a coach of a team group makes next season's group in one step: same organization, same kind and settings, the same positions, the same coaches (and their position
--                                scopes), and the athletes chosen (their position and depth order carried over, and a client's private-from-the-organization setting kept). The old group is retired. Nothing in the old
--                                group is copied or moved: the new season starts clean, and last season stays where it was.
--   unarchive_group(group)       takes a retired group back.
-- Re-runnable.
alter table public.groups add column if not exists archived_at timestamptz;

create or replace function public.start_new_season(p_group uuid, p_name text, p_athletes uuid[])
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  old public.groups%rowtype;
  v_name text := trim(coalesce(p_name, ''));
  v_new uuid;
  v_ids uuid[] := coalesce(p_athletes, '{}');
begin
  if me is null then
    raise exception 'Sign in first.';
  end if;
  select * into old from public.groups where id = p_group for update;
  if not found or not public.is_group_coach(p_group) then
    raise exception 'Only a coach of this group can start its next season.';
  end if;
  if old.group_kind is distinct from 'team' then
    raise exception 'A new season is for a team. A client''s own space and a social group do not have seasons.';
  end if;
  if old.archived_at is not null then
    raise exception 'That season has already been retired.';
  end if;
  if char_length(v_name) < 1 or char_length(v_name) > 120 then
    raise exception 'Give the new season a name (up to 120 characters).';
  end if;
  if cardinality(v_ids) > 500 then
    raise exception 'A season can start with up to 500 athletes. Add the rest afterwards.';
  end if;
  if exists (select 1 from unnest(v_ids) a where not exists (select 1 from public.group_memberships m where m.group_id = p_group and m.profile_id = a and m.role = 'athlete')) then
    raise exception 'Every athlete chosen must be on this season''s roster.';
  end if;

  insert into public.groups (name, description, created_by, organization_id, team_mode, group_kind, focus_tag, gamification_enabled, nutrition_youth_mode)
  values (v_name, old.description, me, old.organization_id, old.team_mode, old.group_kind, old.focus_tag, old.gamification_enabled, old.nutrition_youth_mode)
  returning id into v_new;

  -- the same positions (new rows; a person's place is mapped by the position's name)
  insert into public.group_positions (group_id, name, sort_order)
  select v_new, name, sort_order from public.group_positions where group_id = p_group;

  -- the same coaches, with the position each is responsible for
  insert into public.group_memberships (group_id, profile_id, role, coach_position_id)
  select v_new, m.profile_id, 'coach', (select np.id from public.group_positions op join public.group_positions np on np.group_id = v_new and np.name = op.name where op.id = m.coach_position_id order by np.sort_order, np.id limit 1)
  from public.group_memberships m
  where m.group_id = p_group and m.role = 'coach';

  -- the athletes chosen, in the same place on the depth chart; privacy and nutrition settings travel with the person
  insert into public.group_memberships (group_id, profile_id, role, position_id, depth_order, client_tier, private_from_org, training_level, food_tracking_enabled, coach_sets_macros)
  select v_new, m.profile_id, 'athlete', (select np.id from public.group_positions op join public.group_positions np on np.group_id = v_new and np.name = op.name where op.id = m.position_id order by np.sort_order, np.id limit 1),
         m.depth_order, m.client_tier, m.private_from_org, m.training_level, m.food_tracking_enabled, m.coach_sets_macros
  from public.group_memberships m
  where m.group_id = p_group and m.role = 'athlete' and m.profile_id = any(v_ids);

  update public.groups set archived_at = now() where id = p_group;
  perform public.audit_record('groups', p_group::text, 'update', jsonb_build_object('event', 'start_new_season', 'new_group', v_new, 'athletes', cardinality(v_ids), 'by', me));
  return v_new;
end;
$$;
revoke execute on function public.start_new_season(uuid, text, uuid[]) from public, anon;
grant execute on function public.start_new_season(uuid, text, uuid[]) to authenticated, service_role;

create or replace function public.unarchive_group(p_group uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.is_group_coach(p_group) then
    raise exception 'Only a coach of this group can bring it back.';
  end if;
  update public.groups set archived_at = null where id = p_group;
end;
$$;
revoke execute on function public.unarchive_group(uuid) from public, anon;
grant execute on function public.unarchive_group(uuid) to authenticated, service_role;

commit;
