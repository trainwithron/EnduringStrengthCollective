-- STEP 143 (PRECHECK, run first, changes nothing): 0391 Release H: getting out of an organization (remove a member and hand over their clients, leave, change a role, cancel or extend an invitation, close the organization)
--
-- Paste into the Supabase SQL editor and run. Every row must say ok = true.
-- If any row says false: do NOT run the apply file. Copy the result table and send it back.
select check_name, ok
from (
  values
    ('0391 is not already applied (the remove function is not there yet)',
      to_regprocedure('public.remove_org_member(uuid, uuid, uuid)') is null),
    ('the tables it builds on exist',
      to_regclass('public.organization_memberships') is not null and to_regclass('public.organization_invites') is not null and to_regclass('public.audit_log') is not null and to_regclass('public.bookings') is not null),
    ('the helper functions it uses exist',
      to_regprocedure('public.is_org_owner_or_admin(uuid)') is not null and to_regprocedure('public.audit_record(text, text, text, jsonb)') is not null)
) as checks(check_name, ok);
