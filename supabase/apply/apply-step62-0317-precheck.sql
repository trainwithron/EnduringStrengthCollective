-- STEP 62 (PRECHECK, run first, changes nothing): 0317 A package can include access to a group: one optional column on packages (the group it opens) and one server-only record of the access a package gave, so it can end cleanly when a subscription lapses
--
-- Paste into the Supabase SQL editor and run. Every row must say ok = true.
-- If any row says false: do NOT run the apply file. Copy the result table and send it back.
select check_name, ok
from (
  values
    ('coach_packages exists',
      to_regclass('public.coach_packages') is not null),
    ('0317 is not already applied (packages have no group_access_group_id yet)',
      not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'coach_packages' and column_name = 'group_access_group_id'))
) as checks(check_name, ok);
