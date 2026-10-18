-- STEP 153: 0401 Release U1: graduation (a class year for each team player, and a record of who has been emailed their training history)
--
-- Run apply-precheck first (every row ok = true). Then paste THIS file and run it once.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."
-- AFTERWARDS: Nothing changes on screen until the Release U1 code is live. Adds one empty column (the player's graduation year) and one empty server-only table (who has been sent their history), and one new function, start_next_season, that calls the existing start_new_season (unchanged) and then copies the graduation year to the players brought into the new season. Nothing existing is replaced.
-- ON ERROR: it is all or nothing, so nothing was applied. Run   rollback;   once, copy the red error text, and send it back. Do not run the file again.
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

do $guard$
begin
  if not ((not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'group_memberships' and column_name = 'graduation_year'))) then
    raise exception 'Step 153 (0401) looks already applied, or the database is not in the state it expects. Nothing was changed. Run the precheck file and send Spot the result.';
  end if;
end
$guard$;

-- ====================================================================================================
-- migration 0401_graduation.sql
-- ====================================================================================================

-- Release U1: graduation. A team player can have a graduation year ("class of 2027"). When a coach starts next season, the players whose class has graduated are left unticked by default, and each of them is
-- emailed, once, a PDF of their own training history (sent to the player's own sign-in address only, never to a coach, parent or anyone else).
--
--   group_memberships.graduation_year   the year the player graduates (1990 to 2100), set by the coach (coaches already may update their group's memberships; a player cannot).
--   graduation_exports                  one row per player per season, made BEFORE the email is sent (so two calls at once cannot both send) and stamped sent_at when it has gone; a row never stamped within ten minutes
--                                       (the server died mid-send) can be taken over. Server only.
--   start_next_season                   start_new_season (migration 0394, unchanged) and then the graduation year of each player brought over is copied to the new season. New name, so nothing existing is replaced.
-- Additions only. Re-runnable.
alter table public.group_memberships add column if not exists graduation_year smallint;
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

create or replace function public.start_next_season(p_group uuid, p_name text, p_athletes uuid[])
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
  return v_new;
end;
$$;
revoke execute on function public.start_next_season(uuid, text, uuid[]) from public, anon;
grant execute on function public.start_next_season(uuid, text, uuid[]) to authenticated, service_role;

commit;
