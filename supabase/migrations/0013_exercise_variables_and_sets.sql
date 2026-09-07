-- ============================================================================
-- Per-set prescribed targets + new trackable variables (RIR, Tempo, Time,
-- Height, Distance alongside existing Reps/Weight/RPE), replacing the old
-- "one shared value for the whole exercise" model with one row per set —
-- needed so a coach can prescribe a pyramid (5/5/5/3) instead of one rep
-- target applied uniformly across every set.
-- ============================================================================

create table public.group_workout_exercise_sets (
  id uuid primary key default uuid_generate_v4(),
  group_workout_exercise_id uuid not null references public.group_workout_exercises(id) on delete cascade,
  set_order int not null default 0,
  target_reps text,
  target_weight numeric,
  target_rpe numeric,
  target_rir numeric,
  target_tempo text,
  target_time_seconds numeric,
  target_height numeric,
  target_distance numeric,
  created_at timestamptz not null default now()
);

create index idx_gwes_gwe on public.group_workout_exercise_sets(group_workout_exercise_id);

alter table public.group_workout_exercises
  add column tracked_fields text[] not null default array['reps', 'weight', 'rpe'],
  add column notes text;

-- Backfill: expand each exercise's prescribed_sets count into that many
-- per-set rows, carrying the old shared prescribed_reps forward as every
-- set's target_reps. Must run before the old columns are dropped below.
insert into public.group_workout_exercise_sets (group_workout_exercise_id, set_order, target_reps)
select id, gs, prescribed_reps
from public.group_workout_exercises, generate_series(0, greatest(prescribed_sets, 1) - 1) gs;

alter table public.group_workout_exercises
  drop column prescribed_sets,
  drop column prescribed_reps,
  drop column prescribed_load_note;

-- Per-client overrides become a name-swap only (same set/rep scheme as the
-- template, different exercise) — the numeric override columns are
-- superseded by the per-set template above. Matches the actual use case
-- this table was built for (ladder swap: Push-up instead of Bench Press,
-- same sets/reps, different movement).
alter table public.athlete_exercise_overrides
  drop column prescribed_sets,
  drop column prescribed_reps,
  drop column prescribed_load_note;

-- Actual per-set logged values, mirroring the new target columns above.
-- weight/reps/rpe already exist.
alter table public.set_logs
  add column rir numeric,
  add column tempo text,
  add column time_seconds numeric,
  add column height numeric,
  add column distance numeric;

-- Copied from group_workout_exercises.tracked_fields when a session starts,
-- so the logging screen knows which fields to render for this exercise.
alter table public.session_exercises
  add column tracked_fields text[] not null default array['reps', 'weight'];

-- RLS for the new child table mirrors group_workout_exercises exactly,
-- via a subquery to the parent row since this table has no group_id of
-- its own.
alter table public.group_workout_exercise_sets enable row level security;

create policy "gwes_select_members"
  on public.group_workout_exercise_sets for select
  to authenticated
  using (
    exists (
      select 1 from public.group_workout_exercises g
      where g.id = group_workout_exercise_id and public.is_group_member(g.group_id)
    )
  );

create policy "gwes_write_coach"
  on public.group_workout_exercise_sets for all
  to authenticated
  using (
    exists (
      select 1 from public.group_workout_exercises g
      where g.id = group_workout_exercise_id and public.is_group_coach(g.group_id)
    )
  )
  with check (
    exists (
      select 1 from public.group_workout_exercises g
      where g.id = group_workout_exercise_id and public.is_group_coach(g.group_id)
    )
  );

-- ----------------------------------------------------------------------------
-- WORKOUT_NOTES — freeform text-note cards mixed into a day column
-- alongside exercises. Ordering interleaves with
-- group_workout_exercises.exercise_order as one shared integer sequence per
-- workout_id (no schema tie needed, just consistent assignment from the UI).
-- ----------------------------------------------------------------------------
create table public.workout_notes (
  id uuid primary key default uuid_generate_v4(),
  workout_id uuid not null references public.workouts(id) on delete cascade,
  group_id uuid not null references public.groups(id) on delete cascade,
  body text not null default '',
  position int not null default 0,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_workout_notes_workout on public.workout_notes(workout_id);

alter table public.workout_notes enable row level security;

create policy "workout_notes_select_members"
  on public.workout_notes for select
  to authenticated
  using (public.is_group_member(group_id));

create policy "workout_notes_write_coach"
  on public.workout_notes for all
  to authenticated
  using (public.is_group_coach(group_id))
  with check (public.is_group_coach(group_id));
