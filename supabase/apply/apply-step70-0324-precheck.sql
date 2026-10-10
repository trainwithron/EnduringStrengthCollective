-- STEP 70 (PRECHECK, run first, changes nothing): 0324 AI builder safety: a program the AI builds is a draft (not active, not seen by any client) until the coach signs it off; no path can make an unsigned draft live, and a copy of a draft is a draft
--
-- Paste into the Supabase SQL editor and run. Every row must say ok = true.
-- If any row says false: do NOT run the apply file. Copy the result table and send it back.
select check_name, ok
from (
  values
    ('0324 is not already applied (programs has no ai_draft column yet)',
      not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'programs' and column_name = 'ai_draft')),
    ('the program copy function exists (0318)',
      exists (select 1 from pg_proc where proname = 'duplicate_program' and pronamespace = 'public'::regnamespace))
) as checks(check_name, ok);
