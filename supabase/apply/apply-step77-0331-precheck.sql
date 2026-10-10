-- STEP 77 (PRECHECK, run first, changes nothing): 0331 A paid session pack or membership renewal records its payment event and grants the sessions in ONE database step (a failed grant can no longer leave a handled-looking event with no sessions)
--
-- Paste into the Supabase SQL editor and run. Every row must say ok = true.
-- If any row says false: do NOT run the apply file. Copy the result table and send it back.
select check_name, ok
from (
  values
    ('0331 is not already applied (grant_purchase_once does not exist yet)',
      to_regprocedure('public.grant_purchase_once(text, text, uuid, uuid, uuid, integer, integer, text)') is null),
    ('the purchase tables exist',
      to_regclass('public.credit_purchases') is not null and to_regclass('public.subscription_credit_grants') is not null),
    ('the session ledger grant function exists (0248)',
      to_regprocedure('public.grant_session_credits(uuid, uuid, integer, text, text)') is not null)
) as checks(check_name, ok);
