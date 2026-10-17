-- STEP 137 (PRECHECK, run first, changes nothing): 0386 A client's health form and waiver are finished by the server, never by the browser; a coach's decision on a flagged screening is kept
--
-- Paste into the Supabase SQL editor and run. Every row must say ok = true.
-- If any row says false: do NOT run the apply file. Copy the result table and send it back.
select check_name, ok
from (
  values
    ('0386 is not already applied (the guard function is not there yet)',
      to_regprocedure('public.client_intake_guard_completion()') is null),
    ('the tables it builds on exist',
      to_regclass('public.client_intake') is not null and to_regclass('public.athlete_injury_flag_acknowledgements') is not null)
) as checks(check_name, ok);
