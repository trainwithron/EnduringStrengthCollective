-- STEP 75 (PRECHECK, run first, changes nothing): 0329 Release AA: every session costs exactly 1 credit (the session type's own cost is no longer read) and the waitlist offer shows the coach's time zone
--
-- Paste into the Supabase SQL editor and run. Every row must say ok = true.
-- If any row says false: do NOT run the apply file. Copy the result table and send it back.
select check_name, ok
from (
  values
    ('0329 is not already applied (session_types has no cost-is-one rule yet)',
      not exists (select 1 from pg_constraint where conname = 'session_types_credit_cost_is_one')),
    ('no session type has a cost other than 1 (the rule could not be added otherwise)',
      not exists (select 1 from public.session_types where credit_cost <> 1)),
    ('complete_workout_session is the expected definition (locks the session and still reads the type''s cost)',
      exists (select 1 from pg_proc where proname = 'complete_workout_session' and pronamespace = 'public'::regnamespace and prosrc like '%for update%' and prosrc like '%select credit_cost into v_credit_cost%')),
    ('offer_freed_slot_to_waitlist is the expected definition (still words the time in UTC)',
      exists (select 1 from pg_proc where proname = 'offer_freed_slot_to_waitlist' and pronamespace = 'public'::regnamespace and prosrc like '%to_char(p_start_at, ''Dy Mon DD, HH12:MI AM'')%'))
) as checks(check_name, ok);
