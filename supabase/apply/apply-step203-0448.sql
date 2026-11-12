-- PASTE: step 203 (exercise demos up to 30 seconds of 4K: the size limit goes from 100 MB to 350 MB). Paste all of this into the Supabase SQL editor and Run. The result is 1 row that says true.
update storage.buckets set file_size_limit = 367001600 where id = 'exercise-media';
select file_size_limit = 367001600 as limit_is_350_mb from storage.buckets where id = 'exercise-media';
