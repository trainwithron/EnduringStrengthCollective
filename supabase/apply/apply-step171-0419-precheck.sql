-- STEP 171 (PRECHECK, run first, changes nothing): 0419 Release TS3: saving a filled team sheet (one table, one notice kind, two functions: save the sheets as completed coach-logged workouts on their real dates, and undo a whole upload)
--
-- !! This REBUILDS the notification type list to add one kind (team_sheet_saved), the same widening earlier steps made; it reads the live list first and refuses if the rebuilt list does not match. Everything else is additions only.
--
-- Paste into the Supabase SQL editor and run. Every row must say ok = true.
-- If any row says false: do NOT run the apply file. Copy the result table and send it back.
select check_name, ok
from (
  values
    ('0419 is not already applied (the batch table is not there yet)',
      to_regclass('public.team_sheet_batches') is null),
    ('the functions it finishes a workout with exist',
      to_regprocedure('public.complete_workout_session(uuid)') is not null and to_regprocedure('public.recompute_training_maxes_internal(uuid, text)') is not null and to_regprocedure('public.group_in_active_org(uuid)') is not null and to_regprocedure('public.is_group_coach(uuid)') is not null),
    ('the notification type list it widens is there',
      exists (select 1 from pg_constraint c where c.conname = 'notifications_type_check' and c.conrelid = 'public.notifications'::regclass)),
    ('the tables it writes exist',
      to_regclass('public.athlete_sessions') is not null and to_regclass('public.session_exercises') is not null and to_regclass('public.set_logs') is not null and to_regclass('public.workout_logs') is not null and to_regclass('public.exercise_records') is not null and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'athlete_sessions' and column_name = 'import_batch_id'))
) as checks(check_name, ok);
