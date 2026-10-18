-- STEP 152 (PRECHECK, run first, changes nothing): 0400 Release T1: the front desk (a person an owner or admin invites to check clients in on an organization-wide screen, and nothing else)
--
-- Paste into the Supabase SQL editor and run. Every row must say ok = true.
-- If any row says false: do NOT run the apply file. Copy the result table and send it back.
select check_name, ok
from (
  values
    ('0400 is not already applied (the front-desk table is not there yet)',
      to_regclass('public.org_front_desk') is null),
    ('the tables and helpers it uses exist',
      to_regclass('public.organizations') is not null and to_regclass('public.kiosk_pins') is not null and to_regclass('public.kiosk_checkins') is not null and to_regclass('public.organization_invites') is not null and to_regprocedure('public.is_org_owner_or_admin(uuid)') is not null and to_regprocedure('public.is_group_coach(uuid)') is not null),
    ('the leaving-coach columns it reads exist',
      exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'organization_memberships' and column_name = 'access_ended_at')),
    ('retired groups can be recognised',
      exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'groups' and column_name = 'archived_at'))
) as checks(check_name, ok);
