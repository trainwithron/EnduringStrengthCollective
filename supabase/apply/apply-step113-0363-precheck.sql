-- STEP 113 (PRECHECK, run first, changes nothing): 0363 Smaller goals under a client's goal: either side adds one, the other side agrees or says not now, an agreed one can be marked done (nothing changes a program or a nutrition target)
--
-- Paste into the Supabase SQL editor and run. Every row must say ok = true.
-- If any row says false: do NOT run the apply file. Copy the result table and send it back.
select check_name, ok
from (
  values
    ('0363 is not already applied (the smaller-goals table does not exist yet)',
      to_regclass('public.client_sub_goals') is null),
    ('the goals table and the group helpers exist',
      to_regclass('public.client_goals') is not null and to_regprocedure('public.is_group_coach(uuid)') is not null)
) as checks(check_name, ok);
