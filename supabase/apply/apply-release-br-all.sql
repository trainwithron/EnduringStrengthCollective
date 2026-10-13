-- RELEASE BR (EACH STORAGE BUCKET ACCEPTS ONLY THE FILE TYPES ITS SCREEN UPLOADS; RUN ANY TIME): ONE paste. Steps 112 in order, all or nothing.
--
-- Paste this whole file into the Supabase SQL editor and run it once. It replaces the separate precheck and apply files for these steps (they stay as the fallback).
-- Every check from each step's precheck is built in as a guard in front of that step. If any check is false, the run stops with a message that names the step and the
-- failed check, and NOTHING is kept, so a second run after a refusal is safe.
-- WHAT YOU SHOULD SEE: first "Success" for the transaction, then a result table with one row per step and in_place = true on every row.
-- ON ERROR: run   rollback;   once, copy the red text, send it to Spot. Do not run it again.
-- AFTER STEP 112: Nothing changes for normal use: photos, videos and PDFs upload as before. A file of any other type (an executable, a script, an HTML page) is now refused by the storage service. Existing files are not touched.
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

-- ===== Release BR (each storage bucket accepts only the file types its screen uploads; run any time), step 112: 0362 Each storage bucket accepts only the file types its screen uploads (the three public buckets included), post-media gets a 100 MB size limit, and the signed-out role has no rights on the coach website table
do $g112$
declare
  failed text;
begin
  select string_agg(check_name, '; ') into failed from (
    values
      ('0362 is not already applied (the profile photo bucket has no type list yet)', coalesce((select allowed_mime_types is null from storage.buckets where id = 'coach-profile-photos'), true)),
      ('the storage buckets and the coach website table exist', to_regclass('storage.buckets') is not null and to_regclass('public.coach_sites') is not null)
  ) as checks(check_name, ok) where not ok;
  if failed is not null then
    raise exception 'Release BR (each storage bucket accepts only the file types its screen uploads; run any time), step 112 (0362) cannot run: this step looks already applied, or the database is not in the state it expects. Failed checks: %. NOTHING was changed (the whole bundle is all or nothing). If an earlier step was applied by hand, use the single-step files for the rest, and send Spot this message.', failed;
  end if;
end
$g112$;

-- ====================================================================================================
-- migration 0362_storage_bucket_file_types.sql
-- ====================================================================================================

-- Release BR: each storage bucket accepts only the file types its screen actually uploads (the platform refuses anything else at the door), and the post-media bucket gets the same
-- 100 MB size limit as the other video buckets (it had none). Before this, every bucket accepted any file of any type, including the three PUBLIC buckets (coach profile photos, shop
-- images, organization branding). Existing files are not touched. org-branding keeps SVG because organization logos are allowed to be SVG today.
-- The public coach page reads coach_sites with the server's own key, so the anonymous (signed-out) role gets no access to that table at all, not even the default table rights.
update storage.buckets set allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp'] where id in ('coach-profile-photos', 'pro-shop-images');
update storage.buckets set allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'] where id = 'org-branding';
update storage.buckets set allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp', 'image/heic', 'image/heif'] where id in ('program-covers', 'progress-photos');
update storage.buckets set allowed_mime_types = array['video/mp4', 'video/quicktime', 'video/webm'] where id in ('athlete-exercise-videos', 'exercise-media', 'coach-video-checkins');
update storage.buckets set allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp', 'image/heic', 'image/heif', 'image/gif', 'video/mp4', 'video/quicktime', 'video/webm'], file_size_limit = 104857600 where id = 'post-media';
update storage.buckets set allowed_mime_types = array['application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'image/heic', 'image/heif', 'video/mp4', 'video/quicktime', 'video/webm'] where id = 'client-assessments';
update storage.buckets set allowed_mime_types = array['application/pdf'] where id = 'waiver-documents';

revoke all on public.coach_sites from anon;

commit;

-- Read-only result (after the commit): every row must say in_place = true.
select step, what, in_place from (
  select 'step 112 (0362)' as step, '0362 Each storage bucket accepts only the file types its screen uploads' as what, not ((coalesce((select allowed_mime_types is null from storage.buckets where id = 'coach-profile-photos'), true))) as in_place
) as result order by step;
