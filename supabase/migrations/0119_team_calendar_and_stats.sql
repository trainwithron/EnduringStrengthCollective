-- Team calendar (practices + games) + coach-defined custom stat fields +
-- a purely additive position-scoped coach permission column. Deliberately
-- does NOT touch member_role, is_group_coach, or any of its ~183 existing
-- RLS call sites — see plan context for why that's the safe boundary.

-- Recurring practice slots — same shape as coach_availability_windows
-- (0023), but group-scoped and roster-visible instead of coach-wide.
create table public.team_practice_schedules (
  id uuid primary key default uuid_generate_v4(),
  group_id uuid not null references public.groups(id) on delete cascade,
  title text not null default 'Practice',
  weekday smallint not null check (weekday between 0 and 6),
  start_time time not null,
  end_time time not null check (end_time > start_time),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);
create index team_practice_schedules_group_idx on public.team_practice_schedules(group_id);

-- One-off dated games — opponent/home-away/score is real structure a
-- freeform calendar_events row can't hold.
create table public.team_games (
  id uuid primary key default uuid_generate_v4(),
  group_id uuid not null references public.groups(id) on delete cascade,
  event_date date not null,
  start_time time,
  opponent text not null,
  is_home boolean not null default true,
  our_score int,
  opponent_score int,
  notes text,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);
create index team_games_group_idx on public.team_games(group_id);

-- Coach-defined stat categories per group (sport-agnostic).
create table public.group_stat_fields (
  id uuid primary key default uuid_generate_v4(),
  group_id uuid not null references public.groups(id) on delete cascade,
  name text not null,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  unique (group_id, name)
);

-- One row per (game, athlete, field) — a real editable stat-entry grid
-- cell, matching the per-cell-upsert convention already used elsewhere
-- (body_weight_logs, wellness_checkins) rather than a jsonb blob.
create table public.game_stat_entries (
  id uuid primary key default uuid_generate_v4(),
  game_id uuid not null references public.team_games(id) on delete cascade,
  athlete_id uuid not null references public.profiles(id) on delete cascade,
  field_id uuid not null references public.group_stat_fields(id) on delete cascade,
  value numeric not null default 0,
  unique (game_id, athlete_id, field_id)
);
create index game_stat_entries_game_idx on public.game_stat_entries(game_id);

-- Purely additive — null (every existing coach today) changes nothing
-- about what is_group_coach() or any existing policy grants. Only the
-- new game_stat_entries write policy below reads it.
alter table public.group_memberships
  add column coach_position_id uuid references public.group_positions(id) on delete set null;

alter table public.team_practice_schedules enable row level security;
create policy "team_practice_select_members" on public.team_practice_schedules for select
  to authenticated using (public.is_group_member(group_id));
create policy "team_practice_write_coach" on public.team_practice_schedules for all
  to authenticated using (public.is_group_coach(group_id)) with check (public.is_group_coach(group_id));

alter table public.team_games enable row level security;
create policy "team_games_select_members" on public.team_games for select
  to authenticated using (public.is_group_member(group_id));
create policy "team_games_write_coach" on public.team_games for all
  to authenticated using (public.is_group_coach(group_id)) with check (public.is_group_coach(group_id));

alter table public.group_stat_fields enable row level security;
create policy "group_stat_fields_select_members" on public.group_stat_fields for select
  to authenticated using (public.is_group_member(group_id));
create policy "group_stat_fields_write_coach" on public.group_stat_fields for all
  to authenticated using (public.is_group_coach(group_id)) with check (public.is_group_coach(group_id));

-- The one place tiering actually bites: a position-scoped coach
-- (coach_position_id set) can only enter stats for athletes on that
-- position; a head coach (coach_position_id null) can enter any.
alter table public.game_stat_entries enable row level security;
create policy "game_stat_entries_select_members" on public.game_stat_entries for select
  to authenticated using (
    exists (select 1 from public.team_games g where g.id = game_id and public.is_group_member(g.group_id))
  );
create policy "game_stat_entries_write_coach" on public.game_stat_entries for all
  to authenticated using (
    exists (
      select 1 from public.team_games g
      join public.group_memberships coach_gm on coach_gm.group_id = g.group_id and coach_gm.profile_id = (select auth.uid()) and coach_gm.role = 'coach'
      join public.group_memberships athlete_gm on athlete_gm.group_id = g.group_id and athlete_gm.profile_id = game_stat_entries.athlete_id
      where g.id = game_id
        and (coach_gm.coach_position_id is null or coach_gm.coach_position_id = athlete_gm.position_id)
    )
  )
  with check (
    exists (
      select 1 from public.team_games g
      join public.group_memberships coach_gm on coach_gm.group_id = g.group_id and coach_gm.profile_id = (select auth.uid()) and coach_gm.role = 'coach'
      join public.group_memberships athlete_gm on athlete_gm.group_id = g.group_id and athlete_gm.profile_id = game_stat_entries.athlete_id
      where g.id = game_id
        and (coach_gm.coach_position_id is null or coach_gm.coach_position_id = athlete_gm.position_id)
    )
  );
