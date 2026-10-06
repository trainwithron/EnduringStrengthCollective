-- STEP 22 (PRECHECK, run first, changes nothing): 0280 credit expiry kept human: a coach can hold expiry for one client, give back sessions that expired (up to what expired, logged, undoable), and sets how early they are prompted
--
-- Paste into the Supabase SQL editor and run. Every row must say ok = true.
-- If any row says false: do NOT run the apply file. Copy the result table and send it back.
select check_name, ok
from (
  values
    ('0209 is applied (credit expiry exists)',
      exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'coach_booking_policies' and column_name = 'credit_expiry_days') and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'session_credits' and column_name = 'last_granted_at')),
    ('0246 and 0248 are applied (the ledger and the internal credit function exist)',
      to_regclass('public.session_credit_ledger') is not null and exists (select 1 from pg_proc where proname = 'apply_session_credit_change' and pronamespace = 'public'::regnamespace)),
    ('is_org_admin_of_group exists',
      exists (select 1 from pg_proc where proname = 'is_org_admin_of_group' and pronamespace = 'public'::regnamespace)),
    ('0280 is not already applied (the expiry hold column is not there yet)',
      not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'session_credits' and column_name = 'expiry_hold_until'))
) as checks(check_name, ok);
