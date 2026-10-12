-- STEP 84 (PRECHECK, run first, changes nothing): 0338 A parent-view link can only be made for a client under 13 in a group the coach coaches, and it expires; three internal training-partner functions are closed to the browser
--
-- Paste into the Supabase SQL editor and run. Every row must say ok = true.
-- If any row says false: do NOT run the apply file. Copy the result table and send it back.
select check_name, ok
from (
  values
    ('0338 is not already applied (guardian_links has no expires_at yet)',
      not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'guardian_links' and column_name = 'expires_at')),
    ('the old parent-link rule is still there',
      exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'guardian_links' and policyname = 'guardian_links_coach_manage')),
    ('the group-coach check and the date of birth column exist',
      to_regprocedure('public.is_group_coach(uuid)') is not null and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'client_intake' and column_name = 'date_of_birth')),
    ('the three training-partner functions exist',
      to_regprocedure('public.training_partner_is_minor(uuid)') is not null and to_regprocedure('public.training_partner_intake_incomplete(uuid)') is not null and to_regprocedure('public.training_partner_org_restricted(uuid)') is not null and to_regprocedure('public.training_partner_is_restricted(uuid)') is not null)
) as checks(check_name, ok);
