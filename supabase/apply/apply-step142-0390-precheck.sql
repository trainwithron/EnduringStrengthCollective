-- STEP 142 (PRECHECK, run first, changes nothing): 0390 Release H: undo a whole history import (every workout an import creates carries one batch id)
--
-- Paste into the Supabase SQL editor and run. Every row must say ok = true.
-- If any row says false: do NOT run the apply file. Copy the result table and send it back.
select check_name, ok
from (
  values
    ('0390 is not already applied (the batch column is not there yet)',
      not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'athlete_sessions' and column_name = 'import_batch_id')),
    ('the table it builds on exists',
      to_regclass('public.athlete_sessions') is not null)
) as checks(check_name, ok);
