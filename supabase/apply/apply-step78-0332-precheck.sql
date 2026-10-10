-- STEP 78 (PRECHECK, run first, changes nothing): 0332 In a one-on-one space a program with no client on it is the coach's template: the client can no longer read it (nor its workouts, exercises or sets)
--
-- Paste into the Supabase SQL editor and run. Every row must say ok = true.
-- If any row says false: do NOT run the apply file. Copy the result table and send it back.
select check_name, ok
from (
  values
    ('0332 is not already applied (is_one_on_one_group does not exist yet)',
      to_regprocedure('public.is_one_on_one_group(uuid)') is null),
    ('programs can be removed from a profile (0328, step 74 applied)',
      exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'programs' and column_name = 'archived_at')),
    ('the two helper functions are the 0328 versions (they mention archived_at)',
      exists (select 1 from pg_proc where proname = 'is_ai_draft_program' and pronamespace = 'public'::regnamespace and prosrc like '%archived_at%') and exists (select 1 from pg_proc where proname = 'is_ai_draft_workout' and pronamespace = 'public'::regnamespace and prosrc like '%archived_at%'))
) as checks(check_name, ok);
