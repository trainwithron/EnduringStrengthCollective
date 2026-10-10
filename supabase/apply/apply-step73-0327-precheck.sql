-- STEP 73 (PRECHECK, run first, changes nothing): 0327 Coach message templates: a coach's own wording for the email that carries a client's sign-in link; private to the coach
--
-- Paste into the Supabase SQL editor and run. Every row must say ok = true.
-- If any row says false: do NOT run the apply file. Copy the result table and send it back.
select check_name, ok
from (
  values
    ('0327 is not already applied (coach_message_templates does not exist yet)',
      to_regclass('public.coach_message_templates') is null),
    ('profiles exists',
      to_regclass('public.profiles') is not null)
) as checks(check_name, ok);
