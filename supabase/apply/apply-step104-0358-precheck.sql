-- STEP 104 (PRECHECK, run first, changes nothing): 0358 A personal space: every person can have one space of their own that belongs to no organization, so a coach's own training is one set that follows them into every organization
--
-- Paste into the Supabase SQL editor and run. Every row must say ok = true.
-- If any row says false: do NOT run the apply file. Copy the result table and send it back.
select check_name, ok
from (
  values
    ('0358 is not already applied (the personal-space function does not exist yet)',
      to_regprocedure('public.ensure_personal_space()') is null),
    ('the organization wall function and the groups table exist',
      to_regprocedure('public.group_in_active_org(uuid)') is not null and to_regclass('public.groups') is not null)
) as checks(check_name, ok);
