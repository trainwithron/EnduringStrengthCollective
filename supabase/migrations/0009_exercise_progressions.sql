-- ============================================================================
-- EXERCISE_PROGRESSIONS — a coach-authored rule for how an exercise's
-- weight/reps evolve across a program, personalized per athlete off their
-- own logged history (not a fixed number applied to everyone).
--
-- Progression advances once per "occurrence": every time the exercise name
-- appears in a workout in the program, ordered by (week_number, day_index).
-- Occurrence 1 is always the reference point. This one concept covers both
-- weekly undulation (1 occurrence/week) and daily undulation (multiple
-- occurrences/week) without separate mechanisms.
-- ============================================================================
create type progression_model as enum ('linear', 'wave', 'double_progression');

create table public.exercise_progressions (
  id uuid primary key default uuid_generate_v4(),
  program_id uuid not null references public.programs(id) on delete cascade,
  group_id uuid not null references public.groups(id) on delete cascade, -- denormalized for RLS, matches existing pattern
  exercise_name text not null,
  model progression_model not null,
  -- Model-specific shape (enforced in application code, not the DB):
  --   linear:            { weightIncrement, repIncrement, unit: 'lbs'|'percent' }
  --   wave:               { weightDeltas: number[], repsPattern: number[], unit: 'lbs'|'percent' }
  --   double_progression: { repRangeLow, repRangeHigh, weightIncrement, unit: 'lbs'|'percent' }
  config jsonb not null,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (program_id, exercise_name)
);

create index idx_exercise_progressions_program on public.exercise_progressions(program_id);

alter table public.exercise_progressions enable row level security;

create policy "exercise_progressions_select_members"
  on public.exercise_progressions for select
  to authenticated
  using (public.is_group_member(group_id));

create policy "exercise_progressions_write_coach"
  on public.exercise_progressions for all
  to authenticated
  using (public.is_group_coach(group_id))
  with check (public.is_group_coach(group_id));
