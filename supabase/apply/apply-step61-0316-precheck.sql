-- STEP 61 (PRECHECK, run first, changes nothing): 0316 A program copy remembers which program it was copied from: one optional column (programs.source_program_id) and the copy function now stores it, so the builder can list the clients who hold a copy of a program
--
-- Paste into the Supabase SQL editor and run. Every row must say ok = true.
-- If any row says false: do NOT run the apply file. Copy the result table and send it back.
select check_name, ok
from (
  values
    ('the program copy function exists',
      to_regprocedure('public.duplicate_program(uuid, uuid, uuid, uuid, text, date)') is not null),
    ('0316 is not already applied (programs has no source_program_id yet)',
      not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'programs' and column_name = 'source_program_id'))
) as checks(check_name, ok);
