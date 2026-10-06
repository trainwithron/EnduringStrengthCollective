-- STEP 1 of 2 for migration 0236 (workout session integrity). Run it only AFTER 0248 is applied. Paste into the Supabase SQL editor; it changes nothing.
-- Every row must say ok = true. If any row says false, do NOT run step 2 (apply-0236.sql); send the result back.
select check_name, ok
from (
  values
    ('0248 is applied (bookings.credit_state exists)',
      exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'bookings' and column_name = 'credit_state')),
    ('complete_workout_session is the 0248 version (it settles bookings)',
      coalesce((select position('settle_booking_internal' in pg_get_functiondef(p.oid)) > 0
                from pg_proc p where p.proname = 'complete_workout_session' and p.pronamespace = 'public'::regnamespace), false)),
    ('0236 is not already applied (no unique index on workout_logs.session_id)',
      not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'workout_logs_session_id_key')),
    ('no workout session has two logs already (the unique index would fail)',
      not exists (select 1 from public.workout_logs where session_id is not null group by session_id having count(*) > 1))
) as checks(check_name, ok);
