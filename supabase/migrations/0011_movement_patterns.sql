-- ============================================================================
-- MOVEMENT_PATTERNS — a coach's reusable progression/regression ladders
-- (e.g. "Horizontal Push": Push-up -> DB Bench Press -> Barbell Bench Press),
-- scoped to the coach like exercise_library, shared across every group/
-- program they build. A workout slot can optionally be tagged with one,
-- unlocking: fast up/down scaling, per-client overrides, and client-facing
-- swap alternatives during logging.
-- ============================================================================
create table public.movement_patterns (
  id uuid primary key default uuid_generate_v4(),
  created_by uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  unique (created_by, name)
);

create table public.movement_pattern_exercises (
  id uuid primary key default uuid_generate_v4(),
  movement_pattern_id uuid not null references public.movement_patterns(id) on delete cascade,
  exercise_name text not null,
  difficulty_rank int not null default 0, -- lower = easier/regression, higher = harder/progression
  created_at timestamptz not null default now(),
  unique (movement_pattern_id, exercise_name)
);

create index idx_movement_pattern_exercises_pattern on public.movement_pattern_exercises(movement_pattern_id);

alter table public.group_workout_exercises
  add column movement_pattern_id uuid references public.movement_patterns(id) on delete set null;

alter table public.session_exercises
  add column movement_pattern_id uuid references public.movement_patterns(id) on delete set null;

-- ----------------------------------------------------------------------------
-- ATHLETE_EXERCISE_OVERRIDES — per-client customization on top of a shared
-- group template. The group program stays one shared plan; this is a
-- lightweight override for an individual athlete on a specific slot, not a
-- forked copy of the whole program.
-- ----------------------------------------------------------------------------
create table public.athlete_exercise_overrides (
  id uuid primary key default uuid_generate_v4(),
  group_workout_exercise_id uuid not null references public.group_workout_exercises(id) on delete cascade,
  athlete_id uuid not null references public.profiles(id) on delete cascade,
  group_id uuid not null references public.groups(id) on delete cascade, -- denormalized for RLS
  exercise_name text not null,
  prescribed_sets int,
  prescribed_reps text,
  prescribed_load_note text,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (group_workout_exercise_id, athlete_id)
);

create index idx_athlete_exercise_overrides_athlete on public.athlete_exercise_overrides(athlete_id);

alter table public.movement_patterns enable row level security;
alter table public.movement_pattern_exercises enable row level security;
alter table public.athlete_exercise_overrides enable row level security;

-- Read is open to any authenticated user (low-sensitivity training
-- methodology, not personal data) — write stays owner-only. Revisit once
-- the organizations tier exists and there are unrelated coaches on the
-- platform.
create policy "movement_patterns_select_authenticated"
  on public.movement_patterns for select
  to authenticated
  using (true);

create policy "movement_patterns_write_own"
  on public.movement_patterns for all
  to authenticated
  using (created_by = auth.uid())
  with check (created_by = auth.uid());

create policy "movement_pattern_exercises_select_authenticated"
  on public.movement_pattern_exercises for select
  to authenticated
  using (true);

create policy "movement_pattern_exercises_write_own"
  on public.movement_pattern_exercises for all
  to authenticated
  using (
    exists (
      select 1 from public.movement_patterns mp
      where mp.id = movement_pattern_id and mp.created_by = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.movement_patterns mp
      where mp.id = movement_pattern_id and mp.created_by = auth.uid()
    )
  );

create policy "athlete_exercise_overrides_select_own_or_coach"
  on public.athlete_exercise_overrides for select
  to authenticated
  using (athlete_id = auth.uid() or public.is_group_coach(group_id));

create policy "athlete_exercise_overrides_write_coach"
  on public.athlete_exercise_overrides for all
  to authenticated
  using (public.is_group_coach(group_id))
  with check (public.is_group_coach(group_id));
