-- STEP 134 (PRECHECK, run first, changes nothing): 0383 A text STOP is remembered for the phone number: nobody can opt in with it, and no text goes to it, until it texts START
--
-- Paste into the Supabase SQL editor and run. Every row must say ok = true.
-- If any row says false: do NOT run the apply file. Copy the result table and send it back.
select check_name, ok
from (
  values
    ('0383 is not already applied (the stopped-number list is not there yet)',
      to_regclass('public.sms_suppressed_numbers') is null),
    ('the text consent table and functions exist',
      to_regclass('public.athlete_sms_consent') is not null and to_regprocedure('public.record_sms_stop(text)') is not null and to_regprocedure('public.set_sms_consent(text, boolean, boolean, text)') is not null)
) as checks(check_name, ok);
