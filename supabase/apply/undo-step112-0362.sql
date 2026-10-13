-- UNDO for step 112 (0362). Only if step 112 refuses a file type a screen really needs. Takes the type lists and the post-media size limit off again and gives the signed-out role its default table rights back.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."   Then tell Spot, and do not run the step again until Spot says why it failed.
begin;
update storage.buckets set allowed_mime_types = null where id in ('coach-profile-photos', 'pro-shop-images', 'org-branding', 'program-covers', 'progress-photos', 'athlete-exercise-videos', 'exercise-media', 'coach-video-checkins', 'post-media', 'client-assessments', 'waiver-documents');
update storage.buckets set file_size_limit = null where id = 'post-media';
grant all on public.coach_sites to anon;
commit;
