-- STEP 167 (PRECHECK, run first, changes nothing): 0415 Release AF3e paste A: minor_may_write(), the one question 'may this person write things other people will see?' (function only; nothing uses it yet)
--
-- Paste into the Supabase SQL editor and run. Every row must say ok = true.
-- If any row says false: do NOT run the apply file. Copy the result table and send it back.
select check_name, ok
from (
  values
    ('0415 is not already applied (the function is not there yet)',
      to_regprocedure('public.minor_may_write(uuid)') is null),
    ('the tables it reads exist',
      to_regclass('public.group_memberships') is not null and to_regclass('public.organization_memberships') is not null and to_regclass('public.org_front_desk') is not null and to_regclass('public.client_intake') is not null and to_regclass('public.athlete_profile_details') is not null and to_regclass('public.guardian_consents') is not null)
) as checks(check_name, ok);
