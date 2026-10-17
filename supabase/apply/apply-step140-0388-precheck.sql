-- STEP 140 (PRECHECK, run first, changes nothing): 0388 Switch on the guard: a signed-in person's browser can no longer finish its own health form or waiver (the server does)
--
-- !! Run this only AFTER the Release D code is live (the new health form calls the server). With the old form still showing it would refuse to save.
--
-- Paste into the Supabase SQL editor and run. Every row must say ok = true.
-- If any row says false: do NOT run the apply file. Copy the result table and send it back.
select check_name, ok
from (
  values
    ('step 140 is not already applied (the guard trigger is not there yet)',
      not exists (select 1 from pg_trigger where tgname = 'client_intake_guard_completion' and tgrelid = 'public.client_intake'::regclass)),
    ('step 137 is applied (the guard function exists)',
      to_regprocedure('public.client_intake_guard_completion()') is not null)
) as checks(check_name, ok);
