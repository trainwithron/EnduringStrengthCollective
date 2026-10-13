-- STEP 115 (PRECHECK, run first, changes nothing): 0365 Pattern and class templates: a ladder exercise can be marked one-sided (unilateral); the slot columns on a workout exercise and a client's training level are added (all empty, nothing reads them yet)
--
-- Paste into the Supabase SQL editor and run. Every row must say ok = true.
-- If any row says false: do NOT run the apply file. Copy the result table and send it back.
select check_name, ok
from (
  values
    ('0365 is not already applied (the ladder table has no unilateral column yet)',
      not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'movement_pattern_exercises' and column_name = 'is_unilateral')),
    ('the ladder, workout exercise and membership tables exist',
      to_regclass('public.movement_pattern_exercises') is not null and to_regclass('public.group_workout_exercises') is not null and to_regclass('public.group_memberships') is not null)
) as checks(check_name, ok);
