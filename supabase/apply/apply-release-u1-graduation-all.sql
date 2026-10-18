-- RELEASE U1 (GRADUATION YEARS AND THE GRADUATING PLAYER'S TRAINING HISTORY; ADDS ONLY, SAFE TO RUN BEFORE THE CODE THAT GOES WITH IT IS LIVE): ONE paste. Steps 153 in order, all or nothing.
--
-- Paste this whole file into the Supabase SQL editor and run it once. It replaces the separate precheck and apply files for these steps (they stay as the fallback).
-- Every check from each step's precheck is built in as a guard in front of that step. If any check is false, the run stops with a message that names the step and the
-- failed check, and NOTHING is kept, so a second run after a refusal is safe.
-- WHAT YOU SHOULD SEE: first "Success" for the transaction, then a result table with one row per step and in_place = true on every row.
-- ON ERROR: run   rollback;   once, copy the red text, send it to Spot. Do not run it again.
-- AFTER STEP 153: Nothing changes on screen until the Release U1 code is live. Adds two empty columns (the player's graduation year, and the year a season's graduates were decided by) and one empty server-only table (who has been sent their history), and one new function, start_next_season, that calls the existing start_new_season (unchanged) and then copies the graduation year to the players brought into the new season. Nothing existing is replaced.
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

-- ===== Release U1 (graduation years and the graduating player's training history; adds only, safe to run BEFORE the code that goes with it is live), step 153: 0401 Release U1: graduation (a class year for each team player, and a record of who has been emailed their training history)
do $g153$
declare
  failed text;
begin
  select string_agg(check_name, '; ') into failed from (
    values
      ('0401 is not already applied (the graduation year column is not there yet)', not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'group_memberships' and column_name = 'graduation_year')),
      ('the seasons migration is applied (groups can be retired)', exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'groups' and column_name = 'archived_at') and to_regprocedure('public.start_new_season(uuid, text, uuid[])') is not null)
  ) as checks(check_name, ok) where not ok;
  if failed is not null then
    raise exception 'Release U1 (graduation years and the graduating player''s training history; adds only, safe to run BEFORE the code that goes with it is live), step 153 (0401) cannot run: this step looks already applied, or the database is not in the state it expects. Failed checks: %. NOTHING was changed (the whole bundle is all or nothing). If an earlier step was applied by hand, use the single-step files for the rest, and send Spot this message.', failed;
  end if;
end
$g153$;

-- ====================================================================================================
-- migration 0401_graduation.sql
-- ====================================================================================================

-- Release U1: graduation. A team player can have a graduation year ("class of 2027"). When a coach starts next season, the players whose class has graduated are left unticked by default, and each of them is
-- emailed, once, a PDF of their own training history (sent to the player's own sign-in address only, never to a coach, parent or anyone else).
--
--   group_memberships.graduation_year   the year the player graduates (1990 to 2100), set by the coach (coaches already may update their group's memberships; a player cannot).
--   graduation_exports                  one row per player per season, made BEFORE the email is sent (so two calls at once cannot both send) and stamped sent_at when it has gone. A row never stamped is never
--                                       taken over automatically: the coach is asked. Server only.
--   groups.graduates_through            the year that decided who had graduated, fixed when the season was retired (the coach's own calendar year then), so a later press of the button decides the same way.
--   start_next_season                   start_new_season (migration 0394, unchanged) and then the graduation year of each player brought over is copied to the new season. New name, so nothing existing is replaced.
-- Additions only. Re-runnable.
alter table public.group_memberships add column if not exists graduation_year smallint;
alter table public.groups add column if not exists graduates_through smallint;
alter table public.group_memberships drop constraint if exists group_memberships_graduation_year_range;
alter table public.group_memberships add constraint group_memberships_graduation_year_range check (graduation_year is null or graduation_year between 1990 and 2100);

create table if not exists public.graduation_exports (
  group_id uuid not null references public.groups(id) on delete cascade,
  athlete_id uuid not null references public.profiles(id) on delete cascade,
  claimed_at timestamptz not null default now(),
  sent_at timestamptz,
  primary key (group_id, athlete_id)
);
alter table public.graduation_exports enable row level security;
revoke all on public.graduation_exports from anon, authenticated;

-- graduates_through is set by start_next_season and by nothing else: a coach (or anyone) updating the column directly is refused, so the year that decides who is emailed cannot be changed afterwards.
create or replace function public.guard_graduates_through()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_setting('app.start_next_season', true) = 'on' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.graduates_through is not null then
      raise exception 'The graduation year of a season is set when the season is retired.' using errcode = '42501';
    end if;
  elsif new.graduates_through is distinct from old.graduates_through then
    raise exception 'The graduation year of a season is set when the season is retired.' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke execute on function public.guard_graduates_through() from public, anon, authenticated;
drop trigger if exists groups_guard_graduates_through on public.groups;
create trigger groups_guard_graduates_through
  before insert or update of graduates_through on public.groups
  for each row execute function public.guard_graduates_through();

create or replace function public.start_next_season(p_group uuid, p_name text, p_athletes uuid[], p_graduates_through int default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new uuid;
begin
  -- the same rules and the same checks as before: start_new_season refuses anyone who is not a coach of the group
  if auth.uid() is null or not public.is_group_coach(p_group) then
    raise exception 'Only a coach of this group can start its next season.';
  end if;
  v_new := public.start_new_season(p_group, p_name, p_athletes);
  update public.group_memberships n
     set graduation_year = o.graduation_year
    from public.group_memberships o
   where n.group_id = v_new and n.role = 'athlete'
     and o.group_id = p_group and o.role = 'athlete' and o.profile_id = n.profile_id
     and o.graduation_year is not null;
  -- the year that decided who had graduated, kept on the retired season (only a plausible year: this year or next to it)
  if p_graduates_through is not null and abs(p_graduates_through - extract(year from now())::int) <= 1 then
    perform set_config('app.start_next_season', 'on', true);
    update public.groups set graduates_through = p_graduates_through where id = p_group;
    perform set_config('app.start_next_season', 'off', true);
  end if;
  return v_new;
end;
$$;
revoke execute on function public.start_next_season(uuid, text, uuid[], int) from public, anon;
grant execute on function public.start_next_season(uuid, text, uuid[], int) to authenticated, service_role;

commit;

-- Read-only result (after the commit): every row must say in_place = true.
select step, what, in_place from (
  select 'step 153 (0401)' as step, '0401 Release U1: graduation' as what, not ((not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'group_memberships' and column_name = 'graduation_year'))) as in_place
) as result order by step;
