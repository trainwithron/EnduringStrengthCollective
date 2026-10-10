-- STEP 72 (PRECHECK, run first, changes nothing): 0326 AI builder conversation: an optional chapter-by-chapter conversation where the app asks the coach how they program; the invitation's state and the conversation are private to the coach
--
-- Paste into the Supabase SQL editor and run. Every row must say ok = true.
-- If any row says false: do NOT run the apply file. Copy the result table and send it back.
select check_name, ok
from (
  values
    ('0326 is not already applied (coach_conversations does not exist yet)',
      to_regclass('public.coach_conversations') is null),
    ('the learning settings table exists (0325, step 71)',
      to_regclass('public.coach_learning_settings') is not null)
) as checks(check_name, ok);
