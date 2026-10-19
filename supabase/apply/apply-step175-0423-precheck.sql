-- STEP 175 (PRECHECK, run first, changes nothing): 0423 Release NS: a coach's own switches for the kinds of notice (one new column on profiles, two functions, one trigger on notifications; nothing existing is replaced)
--
-- !! Additions only: one column (empty by default, so everything stays on), two functions and one BEFORE INSERT trigger on notifications that only ever drops a notice for someone who switched that kind off.
--
-- Paste into the Supabase SQL editor and run. Every row must say ok = true.
-- If any row says false: do NOT run the apply file. Copy the result table and send it back.
select check_name, ok
from (
  values
    ('0423 is not already applied (the switch column is not there yet)',
      not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'notices_off')),
    ('the tables it uses exist',
      to_regclass('public.profiles') is not null and to_regclass('public.notifications') is not null)
) as checks(check_name, ok);
