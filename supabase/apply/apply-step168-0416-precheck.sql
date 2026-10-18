-- STEP 168 (PRECHECK, run first, changes nothing): 0416 Release AF3e paste B: the restrictive write guard on posts only
--
-- Paste into the Supabase SQL editor and run. Every row must say ok = true.
-- If any row says false: do NOT run the apply file. Copy the result table and send it back.
select check_name, ok
from (
  values
    ('step 167 (the function) is already applied',
      to_regprocedure('public.minor_may_write(uuid)') is not null),
    ('0416 is not already applied (the posts guard is not there yet)',
      not (exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'posts' and policyname = 'minor_write_guard_insert'))),
    ('the table it guards exists',
      to_regclass('public.posts') is not null)
) as checks(check_name, ok);
