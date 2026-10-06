-- STEP 15 (PRECHECK, run first, changes nothing): 0274 a completed workout is locked against added or deleted sets and against being reopened by the client
--
-- Paste into the Supabase SQL editor and run. Every row must say ok = true.
-- If any row says false: do NOT run the apply file. Copy the result table and send it back.
select check_name, ok
from (
  values
    ('0236 is applied (the completed-workout trigger exists)',
      exists (select 1 from pg_trigger where tgname = 'trg_block_edits_to_completed_session')),
    ('0266 and 0267 are applied (the athlete session guard exists and records blocked writes)',
      coalesce((select position('audit_blocked' in pg_get_functiondef(p.oid)) > 0 from pg_proc p where p.proname = 'guard_athlete_session_columns' and p.pronamespace = 'public'::regnamespace), false)),
    ('0274 is not already applied (the lock only covers updates today)',
      coalesce((select position('tg_op' in pg_get_functiondef(p.oid)) = 0 from pg_proc p where p.proname = 'block_athlete_edits_to_completed_session' and p.pronamespace = 'public'::regnamespace), false))
) as checks(check_name, ok);
