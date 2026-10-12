-- STEP 87 (PRECHECK, run first, changes nothing): 0341 A coach package can only be created, changed or removed by the server (a client could file their own package with thousands of sessions and pay for a cheap one)
--
-- Paste into the Supabase SQL editor and run. Every row must say ok = true.
-- If any row says false: do NOT run the apply file. Copy the result table and send it back.
select check_name, ok
from (
  values
    ('0341 is not already applied (the old write rules are still there)',
      exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'coach_packages' and policyname = 'coach_packages_insert_coach')),
    ('the update and delete rules are still there too',
      exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'coach_packages' and policyname = 'coach_packages_update_coach') and exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'coach_packages' and policyname = 'coach_packages_delete_coach')),
    ('the packages table has its group and session columns',
      exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'coach_packages' and column_name = 'group_id') and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'coach_packages' and column_name = 'sessions_granted'))
) as checks(check_name, ok);
