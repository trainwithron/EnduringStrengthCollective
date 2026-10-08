-- STEP 60 (PRECHECK, run first, changes nothing): 0315 The "I'm away" preset reply: a coach writes one reply, turns it on (optionally with a last day), and every message a client sends them gets that reply back in the thread (marked as an auto-reply). One tiny private table, one marker column, two trigger functions
--
-- Paste into the Supabase SQL editor and run. Every row must say ok = true.
-- If any row says false: do NOT run the apply file. Copy the result table and send it back.
select check_name, ok
from (
  values
    ('direct_messages exists (0140 is applied)',
      to_regclass('public.direct_messages') is not null),
    ('0315 is not already applied (coach_away_replies is not there yet)',
      to_regclass('public.coach_away_replies') is null)
) as checks(check_name, ok);
