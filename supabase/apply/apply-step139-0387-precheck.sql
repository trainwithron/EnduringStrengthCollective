-- STEP 139 (PRECHECK, run first, changes nothing): 0387 Nothing about a person is public unless they chose it: a coach appears in Find a coach only after turning it on for themselves; a coach can add only their own clients to a challenge
--
-- Paste into the Supabase SQL editor and run. Every row must say ok = true.
-- If any row says false: do NOT run the apply file. Copy the result table and send it back.
select check_name, ok
from (
  values
    ('0387 is not already applied (the personal listing column is not there yet)',
      not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'marketplace_listed')),
    ('the tables it builds on exist',
      to_regclass('public.challenge_participants') is not null and to_regclass('public.challenges') is not null)
) as checks(check_name, ok);
