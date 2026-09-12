-- Real fix for Phase 1's low trigger rate: start-workout-button.tsx
-- pre-fills weight (and reps) directly from the program's target the
-- instant a session starts, so "the cell has a value" was never a
-- meaningful signal that the athlete actually attempted the goal — a
-- pre-filled 100 lbs looks identical to a genuinely logged 100 lbs.
-- This column distinguishes them: false at insert time (the default,
-- so the pre-fill itself never counts), flipped true only when the
-- athlete explicitly commits a weight value through the logging UI
-- (typed, or accepted via the swipe/tap suggestion gesture) — see
-- lib/obstacle-unlock.ts and components/logging/exercise-set-grid.tsx.
alter table public.set_logs
  add column weight_confirmed boolean not null default false;
