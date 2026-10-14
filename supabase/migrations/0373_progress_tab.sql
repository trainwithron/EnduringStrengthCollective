-- Release CC: the Progress tab of a client's profile.
--
--   * coach_progress_prefs: the coach's own choices for the Progress cards, stored on their ACCOUNT so they follow them to every device: cards or list, and weight or volume on the small graphs. One
--     row per coach, private to them. An empty metric means "go by the program's training intent".
--   * client_progress_pins: a coach pins an exercise on one client's Progress cards; pinned cards always come first. Per coach and per client, private to that coach, goes with the client's
--     removal from the group (cascade), and sits behind the same organization wall as the other group tables.
--   * client_daily_intake(athlete, group): the calories a client logged each day (skipped meals and entries with no calories left out), summed in the database so the profile does not load every
--     food entry. security invoker, so row security decides who can read it.
-- Re-runnable.

create table if not exists public.coach_progress_prefs (
  coach_id uuid primary key references public.profiles(id) on delete cascade,
  view_mode text not null default 'cards' check (view_mode in ('cards', 'list')),
  metric text check (metric in ('weight', 'volume')),
  updated_at timestamptz not null default now()
);
alter table public.coach_progress_prefs enable row level security;
revoke all on public.coach_progress_prefs from anon;
drop policy if exists "coach_progress_prefs_own" on public.coach_progress_prefs;
create policy "coach_progress_prefs_own" on public.coach_progress_prefs for all to authenticated
  using (coach_id = (select auth.uid()))
  with check (coach_id = (select auth.uid()));

create table if not exists public.client_progress_pins (
  coach_id uuid not null references public.profiles(id) on delete cascade,
  athlete_id uuid not null references public.profiles(id) on delete cascade,
  group_id uuid not null references public.groups(id) on delete cascade,
  exercise_name text not null check (char_length(btrim(exercise_name)) between 1 and 120),
  pinned_at timestamptz not null default now(),
  primary key (coach_id, athlete_id, exercise_name)
);
create index if not exists client_progress_pins_athlete_idx on public.client_progress_pins (athlete_id, group_id);
alter table public.client_progress_pins enable row level security;
revoke all on public.client_progress_pins from anon;
drop policy if exists "client_progress_pins_own_coach" on public.client_progress_pins;
create policy "client_progress_pins_own_coach" on public.client_progress_pins for all to authenticated
  using (coach_id = (select auth.uid()) and public.is_group_coach(group_id))
  with check (coach_id = (select auth.uid()) and public.is_group_coach(group_id));

do $$
begin
  if to_regprocedure('public.group_in_active_org(uuid)') is not null
     and not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'client_progress_pins' and policyname = 'org_wall_header') then
    create policy "org_wall_header" on public.client_progress_pins as restrictive for all to authenticated
      using (public.group_in_active_org(group_id))
      with check (public.group_in_active_org(group_id));
  end if;
end;
$$;

create or replace function public.client_daily_intake(p_athlete uuid, p_group uuid)
returns table (log_date date, calories numeric)
language sql
stable
security invoker
set search_path = public
as $$
  select f.log_date, sum(f.calories)
  from public.food_log_entries f
  where f.athlete_id = p_athlete
    and f.group_id = p_group
    and f.status <> 'skipped'
    and f.calories is not null
  group by f.log_date
  order by f.log_date desc
  limit 800
$$;

revoke all on function public.client_daily_intake(uuid, uuid) from public, anon;
grant execute on function public.client_daily_intake(uuid, uuid) to authenticated;
