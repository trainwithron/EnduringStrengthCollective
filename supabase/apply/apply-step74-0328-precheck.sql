-- STEP 74 (PRECHECK, run first, changes nothing): 0328 Remove a program from a client's profile without deleting it: programs.archived_at; a removed program is inactive and hidden from the client like an unsigned AI draft
--
-- Paste into the Supabase SQL editor and run. Every row must say ok = true.
-- If any row says false: do NOT run the apply file. Copy the result table and send it back.
select check_name, ok
from (
  values
    ('0328 is not already applied (programs has no archived_at column yet)',
      not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'programs' and column_name = 'archived_at')),
    ('the AI draft flag exists (0324, step 70)',
      exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'programs' and column_name = 'ai_draft'))
) as checks(check_name, ok);
