-- STEP 122 (PRECHECK, run first, changes nothing): 0372 Imported history counts: totals, graphs, estimated maxes and records are read from the sets, and training maxes are rebuilt
--
-- Paste into the Supabase SQL editor and run. Every row must say ok = true.
-- If any row says false: do NOT run the apply file. Copy the result table and send it back.
select check_name, ok
from (
  values
    ('0372 is not already applied (no rollup function yet)',
      to_regprocedure('public.client_exercise_rollup(uuid, uuid)') is null),
    ('0371 is applied (the unclear-point mark exists)',
      exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'set_logs' and column_name = 'data_flag')),
    ('the training maxes table and the completion function exist',
      to_regclass('public.athlete_training_maxes') is not null and to_regprocedure('public.complete_workout_session(uuid)') is not null)
) as checks(check_name, ok);
