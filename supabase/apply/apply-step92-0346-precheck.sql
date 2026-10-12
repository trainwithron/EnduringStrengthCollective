-- STEP 92 (PRECHECK, run first, changes nothing): 0346 A coach using the app as their own client can do everything a client can: nutrition phase plans, macro-target feedback and transformation cards no longer require the athlete role; 'Assign to Myself' attaches the program
--
-- Paste into the Supabase SQL editor and run. Every row must say ok = true.
-- If any row says false: do NOT run the apply file. Copy the result table and send it back.
select check_name, ok
from (
  values
    ('0346 is not already applied (the nutrition phase rule still requires the athlete role)',
      exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'client_phase_plans' and policyname = 'client_phase_plans_coach_manage' and position('''athlete''::member_role' in with_check) > 0)),
    ('the assign function and the three tables exist',
      to_regprocedure('public.assign_program_to_client(uuid, uuid, uuid, text, date)') is not null and to_regclass('public.client_phase_plans') is not null and to_regclass('public.client_nutrition_feedback') is not null and to_regclass('public.transformation_cards') is not null)
) as checks(check_name, ok);
