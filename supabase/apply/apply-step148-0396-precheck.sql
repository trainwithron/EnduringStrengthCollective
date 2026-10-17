-- STEP 148 (PRECHECK, run first, changes nothing): 0396 Release L: a leaving coach is never given an organization (their clients stay where they are, they are marked leaving and choose); the finishing step is server-only
--
-- Paste into the Supabase SQL editor and run. Every row must say ok = true.
-- If any row says false: do NOT run the apply file. Copy the result table and send it back.
select check_name, ok
from (
  values
    ('0396 is not already applied (the leaving mark is not there yet)',
      not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'organization_memberships' and column_name = 'departing_since')),
    ('the offboarding steps it replaces exist (step 143 is applied)',
      to_regprocedure('public.remove_org_member(uuid, uuid, uuid)') is not null and to_regprocedure('public._detach_coach_from_org(uuid, uuid, uuid, boolean)') is not null and to_regprocedure('public._solo_org_for(uuid, uuid)') is not null),
    ('the audit writer exists',
      to_regprocedure('public.audit_record(text, text, text, jsonb)') is not null),
    ('the pieces it replaces exist (member check, seat count, ownership transfer, role change, owner push policy)',
      to_regprocedure('public.is_org_member(uuid)') is not null and to_regprocedure('public.org_coach_seats(uuid)') is not null and to_regprocedure('public.transfer_organization_ownership(uuid, uuid)') is not null and to_regprocedure('public.set_org_member_role(uuid, uuid, text)') is not null and exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'push_subscriptions' and policyname = 'push_subscriptions_select_org_owner'))
) as checks(check_name, ok);
