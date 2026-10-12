-- STEP 90 (PRECHECK, run first, changes nothing): 0344 The 'person must belong to the group' rule still lets a coach tidy up an existing row of someone who has since left (refunds and settlements)
--
-- Paste into the Supabase SQL editor and run. Every row must say ok = true.
-- If any row says false: do NOT run the apply file. Copy the result table and send it back.
select check_name, ok
from (
  values
    ('0344 is not already applied (the rule has no exception for existing rows yet)',
      to_regprocedure('public.enforce_athlete_in_group()') is not null and position('v_had_row' in pg_get_functiondef(to_regprocedure('public.enforce_athlete_in_group()'))) = 0),
    ('Release AR is applied (the rule exists)',
      to_regprocedure('public.enforce_athlete_in_group()') is not null)
) as checks(check_name, ok);
