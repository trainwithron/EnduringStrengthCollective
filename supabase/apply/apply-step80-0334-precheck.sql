-- STEP 80 (PRECHECK, run first, changes nothing): 0334 A client can choose whether their first name is shown on their shared workout pictures (on for everyone until they switch it off)
--
-- Paste into the Supabase SQL editor and run. Every row must say ok = true.
-- If any row says false: do NOT run the apply file. Copy the result table and send it back.
select check_name, ok
from (
  values
    ('0334 is not already applied (profiles has no show_name_on_share yet)',
      not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'show_name_on_share')),
    ('profiles has the earlier share-picture column (0197)',
      exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'preferred_share_background'))
) as checks(check_name, ok);
