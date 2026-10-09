-- STEP 66 (PRECHECK, run first, changes nothing): 0320 Image uploads work: the organization logo and app icon, the coach profile photo and the pro shop pictures were refused for everyone because their storage buckets had no rule for looking at a file's row (adds one rule per bucket, the same people who can already write)
--
-- Paste into the Supabase SQL editor and run. Every row must say ok = true.
-- If any row says false: do NOT run the apply file. Copy the result table and send it back.
select check_name, ok
from (
  values
    ('0320 is not already applied (the organization logo bucket has no look rule yet)',
      not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'org_branding_select_owner_admin'))
) as checks(check_name, ok);
