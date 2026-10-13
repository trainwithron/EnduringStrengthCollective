-- STEP 112: 0362 Each storage bucket accepts only the file types its screen uploads (the three public buckets included), post-media gets a 100 MB size limit, and the signed-out role has no rights on the coach website table
--
-- Run apply-precheck first (every row ok = true). Then paste THIS file and run it once.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."
-- AFTERWARDS: Nothing changes for normal use: photos, videos and PDFs upload as before. A file of any other type (an executable, a script, an HTML page) is now refused by the storage service. Existing files are not touched.
-- ON ERROR: it is all or nothing, so nothing was applied. Run   rollback;   once, copy the red error text, and send it back. Do not run the file again.
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

do $guard$
begin
  if not ((coalesce((select allowed_mime_types is null from storage.buckets where id = 'coach-profile-photos'), true))) then
    raise exception 'Step 112 (0362) looks already applied, or the database is not in the state it expects. Nothing was changed. Run the precheck file and send Spot the result.';
  end if;
end
$guard$;

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
