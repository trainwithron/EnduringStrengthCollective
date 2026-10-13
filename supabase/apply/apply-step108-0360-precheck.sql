-- STEP 108 (PRECHECK, run first, changes nothing): 0360 Adding a client works again: the person who has just created a group can seat themselves in it as its coach (a new one-on-one space was refusing its very first membership)
--
-- Paste into the Supabase SQL editor and run. Every row must say ok = true.
-- If any row says false: do NOT run the apply file. Copy the result table and send it back.
select check_name, ok
from (
  values
    ('0360 is not already applied (the creator helper does not exist yet)',
      to_regprocedure('public.group_is_new_and_mine(uuid)') is null),
    ('the membership rule and its helpers exist',
      to_regprocedure('public.group_closed_to_org_admin_join(uuid)') is not null and to_regprocedure('public.is_org_admin_of_group(uuid)') is not null)
) as checks(check_name, ok);
