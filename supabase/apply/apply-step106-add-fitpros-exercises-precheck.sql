-- STEP 106 (PRECHECK, run first, changes nothing): add four exercises to Coach Ron's library (Sissy Squat, Thoracic Extension (Quadruped), Handcuff W Rotation, Incline Iso Lateral Chest Press) so the FitPros history links to real rows; undoable
--
-- !! A one-time data change for Coach Ron's library ONLY. They are marked to be promoted to the shared catalog when it exists.
--
-- Paste into the Supabase SQL editor and run. Every row must say ok = true.
-- If any row says false: do NOT run the apply file. Copy the result table and send it back.
select check_name, ok
from (
  values
    ('Coach Ron''s profile exists',
      exists (select 1 from public.profiles where id = '136394ed-f108-4283-bcb7-310a1ac6cbc8')),
    ('none of the four exercises is in Coach Ron''s library yet',
      not exists (select 1 from public.exercise_library where created_by = '136394ed-f108-4283-bcb7-310a1ac6cbc8' and lower(name) in ('sissy squat', 'thoracic extension (quadruped)', 'handcuff w rotation', 'incline iso lateral chest press')))
) as checks(check_name, ok);
