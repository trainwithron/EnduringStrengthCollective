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
