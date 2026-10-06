-- STEP 28 (PRECHECK, run first, changes nothing): 0285 a record of the rest-day nudges sent, so they can be limited to 2 in any 7 days and stopped after 3 with no response
--
-- Paste into the Supabase SQL editor and run. Every row must say ok = true.
-- If any row says false: do NOT run the apply file. Copy the result table and send it back.
select check_name, ok
from (
  values
    ('profiles and groups exist',
      to_regclass('public.profiles') is not null and to_regclass('public.groups') is not null),
    ('0285 is not already applied (the nudge record is not there yet)',
      to_regclass('public.rest_day_nudges') is null)
) as checks(check_name, ok);
