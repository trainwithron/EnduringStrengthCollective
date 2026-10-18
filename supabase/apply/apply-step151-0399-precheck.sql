-- STEP 151 (PRECHECK, run first, changes nothing): 0399 Release S2: a client's health answers are read only by the client, their coach, and an owner or admin the owner has granted; the address and device of an acceptance only by the audit path
--
-- Paste into the Supabase SQL editor and run. Every row must say ok = true.
-- If any row says false: do NOT run the apply file. Copy the result table and send it back.
select check_name, ok
from (
  values
    ('0399 is not already applied (the grants table is not there yet)',
      to_regclass('public.health_access_grants') is null),
    ('the tables it protects exist',
      to_regclass('public.client_intake') is not null and to_regclass('public.legal_acceptances') is not null),
    ('the helpers it uses exist',
      to_regprocedure('public.is_group_coach(uuid)') is not null and to_regprocedure('public.is_client_private_from_org(uuid, uuid)') is not null and to_regprocedure('public.is_org_owner_or_admin(uuid)') is not null and to_regprocedure('public.audit_record(text, text, text, jsonb)') is not null)
) as checks(check_name, ok);
