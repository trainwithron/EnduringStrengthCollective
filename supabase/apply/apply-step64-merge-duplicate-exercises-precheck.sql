-- STEP 64 (PRECHECK, run first, changes nothing): merge Coach Ron's duplicate exercises into one entry each (13 duplicates into 12 survivors, Ron's library only; every set and log row is kept; undoable)
--
-- !! A one-time data change for Coach Ron's library ONLY. It rewrites the exercise name on his programs, his clients' sessions and records, his patterns, aliases and tags, saves the old duplicate names as aliases of the survivor, and deletes the duplicate library rows. Every changed or deleted row is saved first (exercise_merge_log, exercise_merge_deleted), and the undo file puts it all back. It refuses by itself if any of the 25 library entries is missing or if a name would clash.
--
-- Paste into the Supabase SQL editor and run. Every row must say ok = true.
-- If any row says false: do NOT run the apply file. Copy the result table and send it back.
select check_name, ok
from (
  values
    ('Coach Ron''s profile exists',
      exists (select 1 from public.profiles where id = '136394ed-f108-4283-bcb7-310a1ac6cbc8')),
    ('all 13 duplicate names are in Coach Ron''s library',
      (select count(*) from public.exercise_library where created_by = '136394ed-f108-4283-bcb7-310a1ac6cbc8' and name = any (array['Deadlift', 'Conventional Deadlifts', 'Band Pull-Apart', 'Chin Ups', 'Dips', 'Dumbbell Lateral Raises', 'Farmer''s Carry', 'Lat Pull Down', 'Shoulder CARS', 'Sit Ups', 'Step Ups', 'Bulgarian Split Squats', 'Walking Lunges'])) = 13),
    ('all 12 survivor names are in Coach Ron''s library',
      (select count(*) from public.exercise_library where created_by = '136394ed-f108-4283-bcb7-310a1ac6cbc8' and name = any (array['Conventional Deadlift', 'Band Pull Apart', 'Chin-Up', 'Dip', 'Dumbbell Lateral Raise', 'Farmers Carry', 'Lat Pulldown', 'Shoulder CARs', 'Sit-Up', 'Step Up', 'Bulgarian Split Squat', 'Walking Lunge'])) = 12),
    ('the 10 survivors that Ron''s video is on still have a video',
      (select count(*) from public.exercise_library where created_by = '136394ed-f108-4283-bcb7-310a1ac6cbc8' and name = any (array['Conventional Deadlift', 'Band Pull Apart', 'Chin-Up', 'Dip', 'Dumbbell Lateral Raise', 'Farmers Carry', 'Lat Pulldown', 'Shoulder CARs', 'Sit-Up', 'Step Up']) and (video_path is not null or youtube_url is not null)) = 10),
    ('step 64 is not already applied (the merge log is not there yet)',
      to_regclass('public.exercise_merge_log') is null)
) as checks(check_name, ok);
