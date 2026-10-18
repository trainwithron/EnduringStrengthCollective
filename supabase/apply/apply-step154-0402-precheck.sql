-- STEP 154 (PRECHECK, run first, changes nothing): 0402 Release V1: a parent or guardian's consent for a client aged 13 to 17 (a server-only table of requests and signatures, and one function that says where a client's consent stands)
--
-- Paste into the Supabase SQL editor and run. Every row must say ok = true.
-- If any row says false: do NOT run the apply file. Copy the result table and send it back.
select check_name, ok
from (
  values
    ('0402 is not already applied (the consent table is not there yet)',
      to_regclass('public.guardian_consents') is null),
    ('the tables and helper it uses exist',
      to_regclass('public.profiles') is not null and to_regclass('public.group_memberships') is not null and to_regclass('public.client_intake') is not null and to_regprocedure('public.is_group_coach(uuid)') is not null)
) as checks(check_name, ok);
