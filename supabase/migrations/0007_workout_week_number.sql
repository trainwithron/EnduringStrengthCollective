-- ============================================================================
-- Add explicit week grouping to workouts. A week only "exists" once a
-- workout is saved into it — no separate weeks table needed. Existing
-- workouts default to week 1, matching their current single-week state.
-- ============================================================================
alter table public.workouts
  add column week_number int not null default 1;
