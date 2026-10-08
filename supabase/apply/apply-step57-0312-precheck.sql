-- STEP 57 (PRECHECK, run first, changes nothing): 0312 A client booking or moving their own session must stay inside the coach's open hours and clear of time off: book_session and reschedule_booking now refuse any other time (a coach booking for a client is never refused)
--
-- Paste into the Supabase SQL editor and run. Every row must say ok = true.
-- If any row says false: do NOT run the apply file. Copy the result table and send it back.
select check_name, ok
from (
  values
    ('coach_time_is_open exists (0279 is applied)',
      exists (select 1 from pg_proc where proname = 'coach_time_is_open' and pronamespace = 'public'::regnamespace)),
    ('0291 is applied (book_session checks that the coach coaches the group)',
      coalesce((select position('that coach does not coach this group' in pg_get_functiondef(p.oid)) > 0 from pg_proc p where p.proname = 'book_session' and p.pronamespace = 'public'::regnamespace limit 1), false)),
    ('0312 is not already applied (book_session does not check the hours yet)',
      coalesce((select position('coach_time_is_open' in pg_get_functiondef(p.oid)) = 0 from pg_proc p where p.proname = 'book_session' and p.pronamespace = 'public'::regnamespace limit 1), false))
) as checks(check_name, ok);
