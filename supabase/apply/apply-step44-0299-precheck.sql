-- STEP 44 (PRECHECK, run first, changes nothing): 0299 The record of what people agreed to (beta notice, terms, privacy, waiver) can only be added to: a trigger refuses any change to a row and any truncate, and the app's roles lose update, delete and truncate on it
--
-- Paste into the Supabase SQL editor and run. Every row must say ok = true.
-- If any row says false: do NOT run the apply file. Copy the result table and send it back.
select check_name, ok
from (
  values
    ('legal_acceptances exists (0255)',
      to_regclass('public.legal_acceptances') is not null),
    ('0299 is not already applied (the append-only trigger is not there yet)',
      not exists (select 1 from pg_trigger where tgname = 'legal_acceptances_append_only' and tgrelid = 'public.legal_acceptances'::regclass))
) as checks(check_name, ok);
