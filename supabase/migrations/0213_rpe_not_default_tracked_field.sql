-- Real feedback from Ron: RPE shouldn't show by default on a new
-- exercise — "it just needs to not show up by default... we already have
-- all of the metrics that you can just add more." The actual default a
-- new group_workout_exercises row gets was set here in migration 0013 and
-- lives at the database level (not the lib/exercise-fields.ts constant,
-- which only ever covers a select that returns no tracked_fields at all —
-- never true in practice since this column is not null). Only the
-- default changes going forward; every already-configured exercise's own
-- tracked_fields is untouched, coach-set or not.
alter table public.group_workout_exercises
  alter column tracked_fields set default array['reps', 'weight'];
