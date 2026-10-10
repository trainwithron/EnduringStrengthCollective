-- Release Z: deleting a client no longer fails with a database error because of something they once created.
-- Deleting a person's account has to clear every row that still points at their profile with a "no action" foreign key. The app cleared a hand-written list of about fifteen of them, so one it did not
-- know about (an invite a client had created) stopped the whole delete. This adds one function that does it from the database's own list of such links, so a new one is never missed:
--   * profile_reference_policy(): for each column that points at a profile and would block a delete AND cannot be emptied (it is "not null"), what to do: delete the row (it means nothing without the person:
--     invites they created, their own notes, check-ins, plans, programs, goals and the like) or REFUSE (real shared records: a group or organization they created or own, billing transfers, team games and scores).
--   * detach_profile_references(person): for that person, deletes or empties what points at them (an empty-able column is just emptied), and refuses with a plain message only for the refuse list.
--   * profile_reference_unhandled(): the "not null" links that are in neither list. Empty today; a test fails the moment a new migration adds one, so it has to be decided on purpose.
-- Server only (the service role); signed-in users, signed-out visitors and the public cannot run any of them. No data is touched by this file. Re-runnable.

create or replace function public.profile_reference_policy()
returns table (tbl text, col text, action text)
language sql
immutable
set search_path = pg_catalog
as $$
  select * from (values
    -- meaningless without the person: delete the row
    ('athlete_exercise_overrides', 'created_by', 'delete'),
    ('athlete_notes', 'created_by', 'delete'),
    ('client_goals', 'created_by', 'delete'),
    ('client_habits', 'created_by', 'delete'),
    ('client_tags', 'created_by', 'delete'),
    ('coach_video_checkins', 'created_by', 'delete'),
    ('daily_macros', 'created_by', 'delete'),
    ('exercise_progressions', 'created_by', 'delete'),
    ('group_invites', 'created_by', 'delete'),
    ('guardian_links', 'created_by', 'delete'),
    ('meal_plans', 'created_by', 'delete'),
    ('nutrition_checkins', 'created_by', 'delete'),
    ('nutrition_phases', 'created_by', 'delete'),
    ('org_trainer_dispatch_questions', 'trainer_id', 'delete'),
    ('programs', 'created_by', 'delete'),
    ('workout_assignments', 'created_by', 'delete'),
    ('workout_notes', 'created_by', 'delete'),
    -- real shared records: refuse
    ('game_score_entries', 'logged_by', 'refuse'),
    ('groups', 'created_by', 'refuse'),
    ('organizations', 'owner_id', 'refuse'),
    ('revenue_split_transfers', 'coach_id', 'refuse'),
    ('team_games', 'created_by', 'refuse'),
    ('team_practice_schedules', 'created_by', 'refuse')
  ) as p(tbl, col, action)
$$;

-- Every single-column link from a table in the public schema to a profile that would block deleting the profile (delete rule "no action" or "restrict").
create or replace function public.profile_blocking_links()
returns table (tbl text, col text, not_null boolean)
language sql
stable
set search_path = pg_catalog
as $$
  select rel.relname::text, a.attname::text, a.attnotnull
  from pg_constraint c
  join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
  join pg_class rel on rel.oid = c.conrelid
  where c.contype = 'f'
    and c.confrelid = 'public.profiles'::regclass
    and array_length(c.conkey, 1) = 1
    and c.confdeltype in ('a', 'r')
    and rel.relnamespace = 'public'::regnamespace
$$;

create or replace function public.profile_reference_unhandled()
returns table (tbl text, col text)
language sql
stable
set search_path = pg_catalog, public
as $$
  select l.tbl, l.col
  from public.profile_blocking_links() l
  left join public.profile_reference_policy() p on p.tbl = l.tbl and p.col = l.col
  where l.not_null and p.tbl is null
$$;

create or replace function public.detach_profile_references(p_user uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  r record;
  v_action text;
  v_count bigint;
begin
  -- Refuse first, before anything is changed, so a refused delete leaves everything as it was.
  for r in select l.tbl, l.col from public.profile_blocking_links() l join public.profile_reference_policy() p on p.tbl = l.tbl and p.col = l.col where p.action = 'refuse' loop
    execute format('select count(*) from public.%I where %I = $1', r.tbl, r.col) into v_count using p_user;
    if v_count > 0 then
      raise exception 'cannot_delete: this person still owns shared records (a group, an organization, billing or team records)';
    end if;
  end loop;

  for r in select * from public.profile_blocking_links() loop
    select p.action into v_action from public.profile_reference_policy() p where p.tbl = r.tbl and p.col = r.col;
    if v_action = 'refuse' then
      continue;
    elsif v_action = 'delete' then
      execute format('delete from public.%I where %I = $1', r.tbl, r.col) using p_user;
    elsif not r.not_null then
      execute format('update public.%I set %I = null where %I = $1', r.tbl, r.col, r.col) using p_user;
    else
      -- A "not null" link nobody has decided about: refuse rather than guess.
      execute format('select count(*) from public.%I where %I = $1', r.tbl, r.col) into v_count using p_user;
      if v_count > 0 then
        raise exception 'cannot_delete: this person still has records that need a decision (%.%)', r.tbl, r.col;
      end if;
    end if;
  end loop;
end
$$;

revoke all on function public.profile_reference_policy() from public, anon, authenticated;
revoke all on function public.profile_blocking_links() from public, anon, authenticated;
revoke all on function public.profile_reference_unhandled() from public, anon, authenticated;
revoke all on function public.detach_profile_references(uuid) from public, anon, authenticated;
grant execute on function public.profile_reference_policy() to service_role;
grant execute on function public.profile_blocking_links() to service_role;
grant execute on function public.profile_reference_unhandled() to service_role;
grant execute on function public.detach_profile_references(uuid) to service_role;
