-- STEP 119 (PRECHECK, run first, changes nothing): 0369 The AI you can train: rules the coach teaches that apply only to the clients they fit, a short list of Past AI build notes for each client, corrections recorded with their reason, and the one-time note about how the AI learns
--
-- Paste into the Supabase SQL editor and run. Every row must say ok = true.
-- If any row says false: do NOT run the apply file. Copy the result table and send it back.
select check_name, ok
from (
  values
    ('0369 is not already applied (no AI notes table yet)',
      to_regclass('public.client_ai_notes') is null),
    ('the Stage 2 learning tables exist',
      to_regclass('public.coach_learned_rules') is not null and to_regclass('public.coach_edit_events') is not null)
) as checks(check_name, ok);
