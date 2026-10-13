-- STEP 112 (PRECHECK, run first, changes nothing): 0362 Each storage bucket accepts only the file types its screen uploads (the three public buckets included), post-media gets a 100 MB size limit, and the signed-out role has no rights on the coach website table
--
-- Paste into the Supabase SQL editor and run. Every row must say ok = true.
-- If any row says false: do NOT run the apply file. Copy the result table and send it back.
select check_name, ok
from (
  values
    ('0362 is not already applied (the profile photo bucket has no type list yet)',
      coalesce((select allowed_mime_types is null from storage.buckets where id = 'coach-profile-photos'), true)),
    ('the storage buckets and the coach website table exist',
      to_regclass('storage.buckets') is not null and to_regclass('public.coach_sites') is not null)
) as checks(check_name, ok);
