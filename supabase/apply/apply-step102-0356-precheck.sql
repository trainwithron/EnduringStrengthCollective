-- STEP 102 (PRECHECK, run first, changes nothing): 0356 Asking a happy client for a review, once and quietly: a one-time card after 12 sessions with a box for a short review and a tick to agree the coach may share it publicly, and quotes the coach approves
--
-- Paste into the Supabase SQL editor and run. Every row must say ok = true.
-- If any row says false: do NOT run the apply file. Copy the result table and send it back.
select check_name, ok
from (
  values
    ('0356 is not already applied (no quotes table yet)',
      to_regclass('public.client_quotes') is null),
    ('the coach website table exists',
      to_regclass('public.coach_sites') is not null)
) as checks(check_name, ok);
