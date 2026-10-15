-- STEP 126 (PRECHECK, run first, changes nothing): 0376 The health screening line on a client's Overview stays gone once acknowledged, until a new flagged answer
--
-- Paste into the Supabase SQL editor and run. Every row must say ok = true.
-- If any row says false: do NOT run the apply file. Copy the result table and send it back.
select check_name, ok
from (
  values
    ('0376 is not already applied (no count column yet)',
      not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'athlete_injury_flag_acknowledgements' and column_name = 'flagged_count')),
    ('the acknowledgements table exists',
      to_regclass('public.athlete_injury_flag_acknowledgements') is not null)
) as checks(check_name, ok);
