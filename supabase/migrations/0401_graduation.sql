-- Release U1: graduation. A team player can have a graduation year ("class of 2027"). When a coach starts next season, the players whose class has graduated are left unticked by default, and each of them is
-- emailed, once, a PDF of their own training history (sent to the player's own sign-in address only, never to a coach, parent or anyone else).
--
--   group_memberships.graduation_year   the year the player graduates (1990 to 2100), set by the coach (coaches already may update their group's memberships; a player cannot).
--   graduation_exports                  one row per player per season once their history has been emailed, so it is never sent twice. Server only.
--   start_next_season                   start_new_season (migration 0394, unchanged) and then the graduation year of each player brought over is copied to the new season. New name, so nothing existing is replaced.
-- Additions only. Re-runnable.
alter table public.group_memberships add column if not exists graduation_year smallint;
alter table public.group_memberships drop constraint if exists group_memberships_graduation_year_range;
alter table public.group_memberships add constraint group_memberships_graduation_year_range check (graduation_year is null or graduation_year between 1990 and 2100);

create table if not exists public.graduation_exports (
  group_id uuid not null references public.groups(id) on delete cascade,
  athlete_id uuid not null references public.profiles(id) on delete cascade,
  sent_at timestamptz not null default now(),
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
