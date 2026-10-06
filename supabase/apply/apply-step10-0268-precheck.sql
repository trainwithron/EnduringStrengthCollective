-- STEP 10 (PRECHECK, run first, changes nothing): 0268 guard fixes: a client's new session cannot start pre-flagged, workout totals recompute correctly, audit rows stop copying message text
--
-- Paste into the Supabase SQL editor and run. Every row must say ok = true.
-- If any row says false: do NOT run the apply file. Copy the result table and send it back.
select check_name, ok
from (
  values
    ('0266 and 0267 are applied (the guards and audit_blocked exist)',
      exists (select 1 from pg_proc where proname = 'guard_workout_log_columns' and pronamespace = 'public'::regnamespace) and exists (select 1 from pg_proc where proname = 'audit_blocked' and pronamespace = 'public'::regnamespace) and to_regclass('public.audit_log') is not null),
    ('recompute_workout_log exists',
      exists (select 1 from pg_proc where proname = 'recompute_workout_log' and pronamespace = 'public'::regnamespace)),
    ('0268 is not already applied',
      not exists (select 1 from pg_proc where proname = 'guard_athlete_session_insert' and pronamespace = 'public'::regnamespace))
) as checks(check_name, ok);
