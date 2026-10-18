-- STEP 172 (PRECHECK, run first, changes nothing): 0420 Release OWN1: ownership of an organization cannot be handed to someone who has not accepted their invitation
--
-- !! This REPLACES one function, transfer_organization_ownership. It adds one refusal and changes nothing else; the replaced text was compared with the live database by hash and matches.
--
-- Paste into the Supabase SQL editor and run. Every row must say ok = true.
-- If any row says false: do NOT run the apply file. Copy the result table and send it back.
select check_name, ok
from (
  values
    ('0420 is not already applied (the function does not mention an unaccepted invitation yet)',
      not exists (select 1 from pg_proc where proname = 'transfer_organization_ownership' and pronamespace = 'public'::regnamespace and prosrc like '%has not accepted their invitation%')),
    ('the function it replaces exists',
      to_regprocedure('public.transfer_organization_ownership(uuid, uuid)') is not null),
    ('the account columns it reads exist',
      (select count(*) from information_schema.columns where table_schema = 'auth' and table_name = 'users' and column_name in ('invited_at', 'email_confirmed_at', 'last_sign_in_at')) = 3)
) as checks(check_name, ok);
