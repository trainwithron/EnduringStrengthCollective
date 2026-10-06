-- STEP 14 (PRECHECK, run first, changes nothing): 0273 guards on groups and organizations: ownership, the platform fee, moving a group, the one-on-one rule
--
-- Paste into the Supabase SQL editor and run. Every row must say ok = true.
-- If any row says false: do NOT run the apply file. Copy the result table and send it back.
select check_name, ok
from (
  values
    ('organizations.platform_fee_pct exists and is_platform_admin() exists',
      exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'organizations' and column_name = 'platform_fee_pct') and to_regprocedure('public.is_platform_admin()') is not null),
    ('groups.group_kind exists',
      exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'groups' and column_name = 'group_kind')),
    ('0273 is not already applied (no guard triggers yet)',
      not exists (select 1 from pg_trigger where tgname in ('organizations_guard_columns', 'groups_guard_columns')))
) as checks(check_name, ok);
