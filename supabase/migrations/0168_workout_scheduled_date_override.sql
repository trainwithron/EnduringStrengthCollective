-- Calendar custom-date scheduling (calendar_workout_scheduling_and_
-- adjustable_workspace_idea.md) — per-workout dates were never stored
-- anywhere; every calendar/lock view derives them purely at read time
-- via computeScheduledDates walking forward from a program's own
-- start_date/training_days. That's structurally impossible to support
-- an irregular/custom-cadence client (e.g. 3x/month, pinned to specific
-- calendar dates) — this column is the real fix: when set, it overrides
-- the sequential placement for that one workout only; every other
-- workout in the program keeps deriving its date exactly as before.
alter table public.workouts
  add column if not exists scheduled_date date;

comment on column public.workouts.scheduled_date is
  'Explicit calendar-date override for this one workout, set via day-click-to-assign. When set, computeScheduledDates (lib/program-schedule.ts) uses this verbatim and skips this workout''s own slot in the sequential weekday walk for the rest of the program — never shifts sibling workouts. Null (the common case) means this workout''s date is still fully derived from the program''s start_date/training_days.';
