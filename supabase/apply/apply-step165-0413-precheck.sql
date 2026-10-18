-- STEP 165 (PRECHECK, run first, changes nothing): 0413 Release T2: a fingerprint column so wearable sign-in tokens can be kept scrambled (one empty column and an index)
--
-- Paste into the Supabase SQL editor and run. Every row must say ok = true.
-- If any row says false: do NOT run the apply file. Copy the result table and send it back.
select check_name, ok
from (
  values
    ('0413 is not already applied (the fingerprint column is not there yet)',
      not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'wearable_oauth_tokens' and column_name = 'access_token_hash')),
    ('the table it builds on exists',
      to_regclass('public.wearable_oauth_tokens') is not null)
) as checks(check_name, ok);
