-- STEP 144 (PRECHECK, run first, changes nothing): 0392 Release H: what a coach coaches (asked at signup) and an owner or admin choosing which coach holds a new client
--
-- Paste into the Supabase SQL editor and run. Every row must say ok = true.
-- If any row says false: do NOT run the apply file. Copy the result table and send it back.
select check_name, ok
from (
  values
    ('0392 is not already applied (the coach type column is not there yet)',
      not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'coach_type')),
    ('the tables it builds on exist',
      to_regclass('public.profiles') is not null and to_regclass('public.group_memberships') is not null and to_regclass('public.organization_memberships') is not null),
    ('the helper functions it uses exist',
      to_regprocedure('public.is_org_owner_or_admin(uuid)') is not null and to_regprocedure('public.is_group_coach(uuid)') is not null)
) as checks(check_name, ok);
