-- Release AK: a one-on-one space is its own kind of space, and the database now keeps it that way.
-- (0332 already hides a no-client program in a one-on-one space from the client.) These are the rules that stop it from drifting back:
--   1. PROGRAMS: a program in a one-on-one space must be made FOR that space's client. A new program there with no client is filled in with the space's one client (or refused if
--      there is not exactly one); a program moved into such a space, or whose client is changed, must belong to a client of that space. An existing no-client program there is NOT
--      touched and can still be renamed, copied or deleted (the rule is checked only when a program is created or its space or client changes).
--   2. GROUP-ONLY FEATURES are refused in a one-on-one space: group events, invite links, team games, practice schedules, stat categories.
--   3. A one-on-one space cannot be turned into another kind of space (guard_group_columns; the into-one-on-one client count check stays).
--   4. move_client_to_group says plainly that a one-on-one space holds one client (before, a raw rule failure).
-- guard_group_columns and move_client_to_group are replaced whole, from their LIVE definitions (md5 checked when this was written; permissions unchanged). Requires 0332.

create or replace function public.one_on_one_athlete(_group_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select (array_agg(gm.profile_id))[1] from public.group_memberships gm where gm.group_id = _group_id and gm.role = 'athlete' having count(*) = 1;
$$;
-- Only the trigger below uses this (it runs as the function owner), so nobody signed in needs to call it.
revoke all on function public.one_on_one_athlete(uuid) from public, anon, authenticated;

create or replace function public.guard_one_on_one_program()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_one_on_one_group(new.group_id) then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.group_id is not distinct from old.group_id and new.athlete_id is not distinct from old.athlete_id then
    return new;
  end if;
  if new.athlete_id is null then
    new.athlete_id := public.one_on_one_athlete(new.group_id);
    if new.athlete_id is null then
      raise exception 'A program in a client''s own space has to be made for that client.' using errcode = '23514';
    end if;
  elsif not exists (select 1 from public.group_memberships gm where gm.group_id = new.group_id and gm.profile_id = new.athlete_id and gm.role = 'athlete') then
    raise exception 'A program in a client''s own space has to be made for that client.' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_one_on_one_program() from public, anon, authenticated;

drop trigger if exists programs_guard_one_on_one on public.programs;
create trigger programs_guard_one_on_one
  before insert or update of group_id, athlete_id on public.programs
  for each row execute function public.guard_one_on_one_program();

create or replace function public.refuse_in_one_on_one()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.is_one_on_one_group(new.group_id) then
    raise exception '%', coalesce(tg_argv[0], 'That is not available in a client''s own space.') using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function public.refuse_in_one_on_one() from public, anon, authenticated;

-- Read through to_jsonb so this trigger holds no catalog dependency on group_sessions.kind (Release AB's undo drops that column).
create or replace function public.refuse_event_in_one_on_one()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if to_jsonb(new)->>'kind' = 'event' and public.is_one_on_one_group(nullif(to_jsonb(new)->>'group_id', '')::uuid) then
    raise exception 'Group events are not available in a client''s own space.' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function public.refuse_event_in_one_on_one() from public, anon, authenticated;

drop trigger if exists group_sessions_no_events_one_on_one on public.group_sessions;
create trigger group_sessions_no_events_one_on_one
  before insert on public.group_sessions
  for each row execute function public.refuse_event_in_one_on_one();

drop trigger if exists group_invites_no_one_on_one on public.group_invites;
create trigger group_invites_no_one_on_one
  before insert on public.group_invites
  for each row execute function public.refuse_in_one_on_one('Invite links are not available in a client''s own space.');

drop trigger if exists team_games_no_one_on_one on public.team_games;
create trigger team_games_no_one_on_one
  before insert on public.team_games
  for each row execute function public.refuse_in_one_on_one('Team games are not available in a client''s own space.');

drop trigger if exists team_practice_schedules_no_one_on_one on public.team_practice_schedules;
create trigger team_practice_schedules_no_one_on_one
  before insert on public.team_practice_schedules
  for each row execute function public.refuse_in_one_on_one('Team practice schedules are not available in a client''s own space.');

drop trigger if exists group_stat_fields_no_one_on_one on public.group_stat_fields;
create trigger group_stat_fields_no_one_on_one
  before insert on public.group_stat_fields
  for each row execute function public.refuse_in_one_on_one('Stat categories are not available in a client''s own space.');

create or replace function public.guard_group_columns()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if coalesce(auth.role(), '') not in ('authenticated', 'anon') then
    return new;
  end if;
  if new.organization_id is distinct from old.organization_id then
    raise exception 'A group cannot be moved to another organization.' using errcode = '42501';
  end if;
  if new.created_by is distinct from old.created_by then
    raise exception 'Who created a group cannot be changed.' using errcode = '42501';
  end if;
  if new.group_kind is distinct from old.group_kind and old.group_kind = 'one_on_one' then
    raise exception 'A one-on-one space stays a one-on-one space.' using errcode = '23514';
  end if;
  if new.group_kind is distinct from old.group_kind and new.group_kind = 'one_on_one'
     and (select count(*) from public.group_memberships gm where gm.group_id = new.id and gm.role = 'athlete') > 1 then
    raise exception 'A one-on-one space holds one client. Move the others out first.' using errcode = '23514';
  end if;
  return new;
end;
$function$;

create or replace function public.move_client_to_group(p_athlete_id uuid, p_from_group_id uuid, p_to_group_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if not public.is_group_coach(p_from_group_id) or not public.is_group_coach(p_to_group_id) then
    raise exception 'Must coach both the source and destination group.';
  end if;

  -- A one-on-one space holds ONE client: say so plainly instead of failing later on a database rule.
  if public.is_one_on_one_group(p_to_group_id)
     and exists (select 1 from public.group_memberships where group_id = p_to_group_id and role = 'athlete' and profile_id <> p_athlete_id) then
    raise exception 'A one-on-one space holds one client, and this one already has theirs.';
  end if;

  if exists (
    select 1 from public.group_memberships
    where group_id = p_to_group_id and profile_id = p_athlete_id
  ) then
    raise exception 'This client is already a member of the destination group.';
  end if;

  update public.group_memberships set group_id = p_to_group_id
    where group_id = p_from_group_id and profile_id = p_athlete_id;

  update public.workout_logs set group_id = p_to_group_id
    where group_id = p_from_group_id and athlete_id = p_athlete_id;
  update public.session_credits set group_id = p_to_group_id
    where group_id = p_from_group_id and athlete_id = p_athlete_id;
  update public.body_weight_logs set group_id = p_to_group_id
    where group_id = p_from_group_id and athlete_id = p_athlete_id;
  update public.athlete_notes set group_id = p_to_group_id
    where group_id = p_from_group_id and athlete_id = p_athlete_id;
  update public.client_habits set group_id = p_to_group_id
    where group_id = p_from_group_id and athlete_id = p_athlete_id;
  update public.daily_macros set group_id = p_to_group_id
    where group_id = p_from_group_id and athlete_id = p_athlete_id;
  update public.workout_assignments set group_id = p_to_group_id
    where group_id = p_from_group_id and athlete_id = p_athlete_id;
  update public.bookings set group_id = p_to_group_id
    where group_id = p_from_group_id and athlete_id = p_athlete_id;
  update public.athlete_sessions set group_id = p_to_group_id
    where group_id = p_from_group_id and athlete_id = p_athlete_id;
  update public.meal_plans set group_id = p_to_group_id
    where group_id = p_from_group_id and athlete_id = p_athlete_id;
  update public.athlete_exercise_overrides set group_id = p_to_group_id
    where group_id = p_from_group_id and athlete_id = p_athlete_id;
  update public.credit_purchases set group_id = p_to_group_id
    where group_id = p_from_group_id and athlete_id = p_athlete_id;
  update public.subscription_credit_grants set group_id = p_to_group_id
    where group_id = p_from_group_id and athlete_id = p_athlete_id;
  update public.membership_subscriptions set group_id = p_to_group_id
    where group_id = p_from_group_id and athlete_id = p_athlete_id;

  update public.programs set group_id = p_to_group_id
    where group_id = p_from_group_id and athlete_id = p_athlete_id;
  update public.workouts set group_id = p_to_group_id
    where group_id = p_from_group_id and athlete_id = p_athlete_id;
  update public.group_workout_exercises set group_id = p_to_group_id
    where group_id = p_from_group_id and athlete_id = p_athlete_id;
  update public.workout_notes set group_id = p_to_group_id
    where group_id = p_from_group_id and athlete_id = p_athlete_id;

  delete from public.package_assignments
    where athlete_id = p_athlete_id
      and coach_package_id in (select id from public.coach_packages where group_id = p_from_group_id);
end;
$function$;
