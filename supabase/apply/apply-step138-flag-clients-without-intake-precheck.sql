-- STEP 138 (PRECHECK, run first, changes nothing): HELD for Ron's word: require the health form and waiver of every client who has not finished one
--
-- !! DO NOT RUN until Ron says so. It changes what real clients see: each of them is sent to the health form the next time they open the app. Run check-intake-flag-list.sql first and read the names.
--
-- Paste into the Supabase SQL editor and run. Every row must say ok = true.
-- If any row says false: do NOT run the apply file. Copy the result table and send it back.
select check_name, ok
from (
  values
    ('the column it sets exists',
      exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'intake_required')),
    ('the intake table exists',
      to_regclass('public.client_intake') is not null),
    ('step 138 is not already applied (the flag log is not there yet)',
      to_regclass('public.intake_flag_log') is null)
) as checks(check_name, ok);
