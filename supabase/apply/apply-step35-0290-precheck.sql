-- STEP 35 (PRECHECK, run first, changes nothing): 0290 four database closures: a membership can no longer be handed to another person, the two AI-credit spending functions are server-only and refuse negative amounts, two private video buckets are readable only by the person they belong to and the coaches, and a client who joined by invite link is marked as signed in
--
-- Paste into the Supabase SQL editor and run. Every row must say ok = true.
-- If any row says false: do NOT run the apply file. Copy the result table and send it back.
select check_name, ok
from (
  values
    ('group_memberships, coach_credits and session_exercise_videos exist',
      to_regclass('public.group_memberships') is not null and to_regclass('public.coach_credits') is not null and to_regclass('public.session_exercise_videos') is not null),
    ('spend_ai_action, spend_coach_credits, audit_blocked exist',
      exists (select 1 from pg_proc where proname = 'spend_ai_action' and pronamespace = 'public'::regnamespace) and exists (select 1 from pg_proc where proname = 'spend_coach_credits' and pronamespace = 'public'::regnamespace) and exists (select 1 from pg_proc where proname = 'audit_blocked' and pronamespace = 'public'::regnamespace)),
    ('0290 is not already applied (the membership identity guard is not there yet)',
      not exists (select 1 from pg_trigger where tgname = 'group_memberships_guard_identity'))
) as checks(check_name, ok);
