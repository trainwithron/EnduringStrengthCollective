-- STEP 183 (PRECHECK, run first, changes nothing): 0431 A coach's own passages for Read during rest (one new table: a coach adds a reference and its text, and it joins his clients' passage cycle)
--
-- !! This adds one table, coach_read_passages (a reference up to 60 characters and its text up to 600, for one coach), with row security: the coach reads, adds, changes and removes only his own; a person in a group he coaches can read them. Nothing existing is changed.
--
-- Paste into the Supabase SQL editor and run. Every row must say ok = true.
-- If any row says false: do NOT run the apply file. Copy the result table and send it back.
select check_name, ok
from (
  values
    ('0431 is not already applied (the coach_read_passages table is not there yet)',
      to_regclass('public.coach_read_passages') is null),
    ('the tables it uses exist',
      to_regclass('public.group_memberships') is not null and to_regclass('public.profiles') is not null)
) as checks(check_name, ok);
