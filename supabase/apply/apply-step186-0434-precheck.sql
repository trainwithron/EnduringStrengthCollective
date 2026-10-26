-- STEP 186 (PRECHECK, run first, changes nothing): 0434 The platform demo library: every coach and client can see the demos on a platform admin's exercises (one read function, one file-read rule)
--
-- !! This adds platform_demo_rows() (signed-in people only: the name, uploaded video and YouTube link of each platform-admin exercise that has a demo, nothing else of those rows), is_platform_demo_object(name) (whether a stored file is one of those videos) and ONE storage rule, exercise_media_select_platform_demo: a signed-in person can read exactly those video files in the exercise-media bucket. Uploading and deleting are unchanged (only your own folder), and exercise_library's own row security is unchanged: other coaches still cannot read the platform admin's rows themselves.
--
-- Paste into the Supabase SQL editor and run. Every row must say ok = true.
-- If any row says false: do NOT run the apply file. Copy the result table and send it back.
select check_name, ok
from (
  values
    ('0434 is not already applied',
      to_regprocedure('public.platform_demo_rows()') is null and not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'exercise_media_select_platform_demo')),
    ('the library, the platform admin mark and the bucket exist',
      to_regclass('public.exercise_library') is not null and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'is_platform_admin') and exists (select 1 from storage.buckets where id = 'exercise-media')),
    ('the existing file rules are the three expected ones (read own or shared group, upload own folder, delete own folder)',
      (select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname in ('exercise_media_select_owner_or_shared_group', 'exercise_media_insert_own_folder', 'exercise_media_delete_own')) = 3)
) as checks(check_name, ok);
