-- STEP 166 (PRECHECK, run first, changes nothing): 0414 Release CS1: a group setting for post-workout cards and PR notices (one nullable column)
--
-- Paste into the Supabase SQL editor and run. Every row must say ok = true.
-- If any row says false: do NOT run the apply file. Copy the result table and send it back.
select check_name, ok
from (
  values
    ('0414 is not already applied (the setting column is not there yet)',
      not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'groups' and column_name = 'post_workout_cards')),
    ('the table it builds on exists',
      to_regclass('public.groups') is not null)
) as checks(check_name, ok);
