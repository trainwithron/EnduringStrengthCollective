-- STEP 67 (PRECHECK, run first, changes nothing): 0321 A coach's one short public website (My website): a private table for what the coach types, and a featured flag on Pro Shop cards (nothing is public until the coach publishes)
--
-- Paste into the Supabase SQL editor and run. Every row must say ok = true.
-- If any row says false: do NOT run the apply file. Copy the result table and send it back.
select check_name, ok
from (
  values
    ('0321 is not already applied (there is no coach_sites table yet)',
      to_regclass('public.coach_sites') is null)
) as checks(check_name, ok);
