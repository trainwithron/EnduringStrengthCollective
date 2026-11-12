-- Exercise demos up to 30 seconds of 4K (Ron, Nov 12: "lets do a 30 second limit at 4k"). 30 seconds of 4K from a phone is about 180 MB at 30 frames a second and 300 MB at 60,
-- so the exercise-media bucket's limit goes from 100 MB to 350 MB. The 30 seconds is checked in the app (lib/exercise-demo-upload.ts). Nothing else changes.
update storage.buckets set file_size_limit = 367001600 where id = 'exercise-media';
