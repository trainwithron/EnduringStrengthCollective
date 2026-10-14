-- STEP 123 (PRECHECK, run first, changes nothing): 0373 The Progress tab: your card and graph choices, pinned exercises, and the daily calories a client logged
--
-- Paste into the Supabase SQL editor and run. Every row must say ok = true.
-- If any row says false: do NOT run the apply file. Copy the result table and send it back.
select check_name, ok
from (
  values
    ('0373 is not already applied (no pins table yet)',
      to_regclass('public.client_progress_pins') is null),
    ('the food log table exists',
      to_regclass('public.food_log_entries') is not null),
    ('the org wall check exists',
      to_regprocedure('public.group_in_active_org(uuid)') is not null)
) as checks(check_name, ok);
