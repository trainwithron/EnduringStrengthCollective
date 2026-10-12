-- STEP 88 (PRECHECK, run first, changes nothing): 0342 Private lookups the row rules use can't be asked about other people by any signed-in account (who shares an organization, who blocked whom, who is a client of a group, who is hidden from the organization, a coach's client count)
--
-- Paste into the Supabase SQL editor and run. Every row must say ok = true.
-- If any row says false: do NOT run the apply file. Copy the result table and send it back.
select check_name, ok
from (
  values
    ('0342 is not already applied (the coach-count function can still be run by a signed-in user)',
      has_function_privilege('authenticated', 'public.coach_ai_multiplier(uuid)', 'execute')),
    ('the five functions exist',
      to_regprocedure('public.training_partners_share_org(uuid, uuid)') is not null and to_regprocedure('public.training_partners_mutually_blocked(uuid, uuid)') is not null and to_regprocedure('public.is_training_client_of_group(uuid, uuid)') is not null and to_regprocedure('public.is_client_private_from_org(uuid, uuid)') is not null and to_regprocedure('public.is_wearable_subject_private_from_org(uuid)') is not null),
    ('the helpers they now call exist',
      to_regprocedure('public.is_group_coach(uuid)') is not null and to_regprocedure('public.is_org_admin_of_group(uuid)') is not null and to_regprocedure('public.is_platform_admin()') is not null),
    ('the two coach-count functions exist',
      to_regprocedure('public.coach_ai_multiplier(uuid)') is not null and to_regprocedure('public.coach_client_steps(uuid)') is not null)
) as checks(check_name, ok);
