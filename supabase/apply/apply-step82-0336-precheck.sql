-- STEP 82 (PRECHECK, run first, changes nothing): 0336 The 'What do you call your people?' card is asked once, for good (remembered on the coach's profile; every coach already here counts as answered)
--
-- Paste into the Supabase SQL editor and run. Every row must say ok = true.
-- If any row says false: do NOT run the apply file. Copy the result table and send it back.
select check_name, ok
from (
  values
    ('0336 is not already applied (profiles has no terminology_asked_at yet)',
      not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'terminology_asked_at')),
    ('coaches are recorded in group_memberships',
      exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'group_memberships' and column_name = 'role'))
) as checks(check_name, ok);
