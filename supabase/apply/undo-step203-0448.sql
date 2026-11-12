-- UNDO step 203: the exercise-media size limit goes back to 100 MB (videos already stored stay).
update storage.buckets set file_size_limit = 104857600 where id = 'exercise-media';
