-- STEP 156 (PRECHECK, run first, changes nothing): 0404 Release X1: the narrow reads athletes' screens use to see who else is in their group (a name, a photo, a role and a position, nothing else)
--
-- Paste into the Supabase SQL editor and run. Every row must say ok = true.
-- If any row says false: do NOT run the apply file. Copy the result table and send it back.
select check_name, ok
from (
  values
    ('0404 is not already applied (the member-names function is not there yet)',
      to_regprocedure('public.group_member_names(uuid)') is null),
    ('the tables and helper it uses exist',
      to_regclass('public.group_memberships') is not null and to_regclass('public.profiles') is not null and to_regclass('public.group_positions') is not null and to_regprocedure('public.is_group_member(uuid)') is not null)
) as checks(check_name, ok);
