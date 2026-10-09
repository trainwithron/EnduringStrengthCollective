-- STEP 63 (PRECHECK, run first, changes nothing): 0318 A program copy is named "Program - Client" without stacking: assigning a client's copy to someone else drops the old client's tail, and a name that already ends with this client gets nothing added (the copy function only; existing programs are not renamed)
--
-- Paste into the Supabase SQL editor and run. Every row must say ok = true.
-- If any row says false: do NOT run the apply file. Copy the result table and send it back.
select check_name, ok
from (
  values
    ('the program copy function exists with the source link (step 61 is applied)',
      exists (select 1 from pg_proc where proname = 'duplicate_program' and pronamespace = 'public'::regnamespace and position('ai_sequencing_notes, source_program_id' in prosrc) > 0)),
    ('0318 is not already applied (the copy function does not strip a client tail yet)',
      not exists (select 1 from pg_proc where proname = 'duplicate_program' and pronamespace = 'public'::regnamespace and position('v_tail' in prosrc) > 0))
) as checks(check_name, ok);
