-- STEP 89 (PRECHECK, run first, changes nothing): 0343 A coach's credit pack or Lift Off grant is recorded and added in one step (a failed add is retried instead of lost)
--
-- Paste into the Supabase SQL editor and run. Every row must say ok = true.
-- If any row says false: do NOT run the apply file. Copy the result table and send it back.
select check_name, ok
from (
  values
    ('0343 is not already applied (the credit-pack function does not exist yet)',
      to_regprocedure('public.grant_coach_credit_pack_once(text, text, uuid, integer, integer)') is null),
    ('the credit adjust function and both record tables exist',
      to_regprocedure('public.adjust_coach_credits(uuid, integer)') is not null and to_regclass('public.coach_credit_purchases') is not null and to_regclass('public.lift_off_credit_grants') is not null)
) as checks(check_name, ok);
