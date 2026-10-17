-- STEP 136 (PRECHECK, run first, changes nothing): 0385 The kind of each set (warm-up, working, as-many-as-possible, back-off, drop); a warm-up or drop set never counts toward a goal, a record or a training max; records are per number of reps and a longer hold is a record; a training max comes only from a set of 1 to 8 reps
--
-- Paste into the Supabase SQL editor and run. Every row must say ok = true.
-- If any row says false: do NOT run the apply file. Copy the result table and send it back.
select check_name, ok
from (
  values
    ('0385 is not already applied (the set-type column is not there yet)',
      not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'set_logs' and column_name = 'set_type')),
    ('the functions it replaces exist',
      to_regprocedure('public.recompute_training_maxes(uuid, text)') is not null and to_regprocedure('public.recompute_training_max()') is not null and to_regprocedure('public.complete_workout_session(uuid)') is not null),
    ('the imported-history flag it builds on exists',
      exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'set_logs' and column_name = 'data_flag'))
) as checks(check_name, ok);
