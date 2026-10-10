-- STEP 71 (PRECHECK, run first, changes nothing): 0325 AI builder learning: the changes a coach makes to an AI draft are noted privately, one quiet question can be asked per pattern, and what the coach said Yes to is kept in one list they can undo
--
-- Paste into the Supabase SQL editor and run. Every row must say ok = true.
-- If any row says false: do NOT run the apply file. Copy the result table and send it back.
select check_name, ok
from (
  values
    ('0325 is not already applied (programs has no ai_snapshot column yet)',
      not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'programs' and column_name = 'ai_snapshot')),
    ('the AI draft flag exists (0324, step 70)',
      exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'programs' and column_name = 'ai_draft')),
    ('the standing preferences table exists (0164)',
      to_regclass('public.coach_program_preferences') is not null)
) as checks(check_name, ok);
