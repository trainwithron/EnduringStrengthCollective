-- STEP 153 (PRECHECK, run first, changes nothing): 0401 Release U1: graduation (a class year for each team player, and a record of who has been emailed their training history)
--
-- Paste into the Supabase SQL editor and run. Every row must say ok = true.
-- If any row says false: do NOT run the apply file. Copy the result table and send it back.
select check_name, ok
from (
  values
    ('0401 is not already applied (the graduation year column is not there yet)',
      not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'group_memberships' and column_name = 'graduation_year')),
    ('the seasons migration is applied (groups can be retired)',
      exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'groups' and column_name = 'archived_at') and to_regprocedure('public.start_new_season(uuid, text, uuid[])') is not null)
) as checks(check_name, ok);
