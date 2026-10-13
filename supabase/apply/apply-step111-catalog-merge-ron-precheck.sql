-- STEP 111 (PRECHECK, run first, changes nothing): Coach Ron's exercise names: 9 merges and 9 renames (the implement stated), his four FitPros exercises, and the shared catalog filled from his library; undoable
--
-- !! A one-time data change for Coach Ron's library and world ONLY, decided by Ron on Oct 12. Run step 110 first. It rewrites the exercise name in his programs, his clients' sessions, records, patterns, tags and maxes, saves each old name as an alias of the final one, deletes the merged-away library rows, and fills the catalog. Every changed or deleted row is saved first (exercise_catalog_merge_log, exercise_catalog_merge_deleted) and the undo file puts it all back. It refuses by itself if any old name is missing from his library.
--
-- Paste into the Supabase SQL editor and run. Every row must say ok = true.
-- If any row says false: do NOT run the apply file. Copy the result table and send it back.
select check_name, ok
from (
  values
    ('Coach Ron''s profile exists',
      exists (select 1 from public.profiles where id = '136394ed-f108-4283-bcb7-310a1ac6cbc8')),
    ('step 110 is applied (the catalog is there and empty)',
      case when to_regclass('public.exercise_catalog') is null then false else (xpath('/row/c/text()', query_to_xml('select count(*) as c from public.exercise_catalog', false, true, '')))[1]::text = '0' end),
    ('PREVIEW Back Squat + Barbell Back Squats -> Barbell Back Squat (all these names are in Coach Ron''s library)',
      (select count(*) from public.exercise_library where created_by = '136394ed-f108-4283-bcb7-310a1ac6cbc8' and name = any (array['Back Squat', 'Barbell Back Squats'])) = 2),
    ('PREVIEW Front Squat + Barbell Front Squats -> Barbell Front Squat (all these names are in Coach Ron''s library)',
      (select count(*) from public.exercise_library where created_by = '136394ed-f108-4283-bcb7-310a1ac6cbc8' and name = any (array['Front Squat', 'Barbell Front Squats'])) = 2),
    ('PREVIEW Leg Extension + Leg Extension Machine -> Leg Extension (all these names are in Coach Ron''s library)',
      (select count(*) from public.exercise_library where created_by = '136394ed-f108-4283-bcb7-310a1ac6cbc8' and name = any (array['Leg Extension', 'Leg Extension Machine'])) = 2),
    ('PREVIEW Dumbbell Skull Crusher + Dumbbell Tricep Skull Crushers -> Dumbbell Skull Crusher (all these names are in Coach Ron''s library)',
      (select count(*) from public.exercise_library where created_by = '136394ed-f108-4283-bcb7-310a1ac6cbc8' and name = any (array['Dumbbell Skull Crusher', 'Dumbbell Tricep Skull Crushers'])) = 2),
    ('PREVIEW Incline Dumbbell Bench Press + Incline Dumbbell Press -> Incline Dumbbell Bench Press (all these names are in Coach Ron''s library)',
      (select count(*) from public.exercise_library where created_by = '136394ed-f108-4283-bcb7-310a1ac6cbc8' and name = any (array['Incline Dumbbell Bench Press', 'Incline Dumbbell Press'])) = 2),
    ('PREVIEW Single Arm Farmers Carry + Suitcase Carry (Single Arm Farmers Carry) -> Suitcase Carry (all these names are in Coach Ron''s library)',
      (select count(*) from public.exercise_library where created_by = '136394ed-f108-4283-bcb7-310a1ac6cbc8' and name = any (array['Single Arm Farmers Carry', 'Suitcase Carry (Single Arm Farmers Carry)'])) = 2),
    ('PREVIEW Kettlebell Swing + Russian Kettlebell Swing -> Kettlebell Swing (all these names are in Coach Ron''s library)',
      (select count(*) from public.exercise_library where created_by = '136394ed-f108-4283-bcb7-310a1ac6cbc8' and name = any (array['Kettlebell Swing', 'Russian Kettlebell Swing'])) = 2),
    ('PREVIEW Rear Foot Elevated Split Squat + Dumbbell Rear Foot Elevated Split Squat -> Dumbbell Rear Foot Elevated Split Squat (all these names are in Coach Ron''s library)',
      (select count(*) from public.exercise_library where created_by = '136394ed-f108-4283-bcb7-310a1ac6cbc8' and name = any (array['Rear Foot Elevated Split Squat', 'Dumbbell Rear Foot Elevated Split Squat'])) = 2),
    ('PREVIEW Walking Lunge + Dumbbell Walking Lunge -> Dumbbell Walking Lunge (all these names are in Coach Ron''s library)',
      (select count(*) from public.exercise_library where created_by = '136394ed-f108-4283-bcb7-310a1ac6cbc8' and name = any (array['Walking Lunge', 'Dumbbell Walking Lunge'])) = 2),
    ('PREVIEW Face Pull -> Banded Face Pull (stays separate from Cable Face Pull and Barbell Face Pull) (all these names are in Coach Ron''s library)',
      (select count(*) from public.exercise_library where created_by = '136394ed-f108-4283-bcb7-310a1ac6cbc8' and name = any (array['Face Pull'])) = 1),
    ('PREVIEW Cable Face Pulls -> Cable Face Pull (all these names are in Coach Ron''s library)',
      (select count(*) from public.exercise_library where created_by = '136394ed-f108-4283-bcb7-310a1ac6cbc8' and name = any (array['Cable Face Pulls'])) = 1),
    ('PREVIEW Romanian Deadlift -> Barbell Romanian Deadlift (Dumbbell Romanian Deadlift stays separate) (all these names are in Coach Ron''s library)',
      (select count(*) from public.exercise_library where created_by = '136394ed-f108-4283-bcb7-310a1ac6cbc8' and name = any (array['Romanian Deadlift', 'Dumbbell Romanian Deadlift'])) = 2),
    ('PREVIEW Reverse Lunge -> Dumbbell Reverse Lunge (Barbell Reverse Lunge stays separate) (all these names are in Coach Ron''s library)',
      (select count(*) from public.exercise_library where created_by = '136394ed-f108-4283-bcb7-310a1ac6cbc8' and name = any (array['Reverse Lunge', 'Barbell Reverse Lunge'])) = 2),
    ('PREVIEW Split Squat -> Dumbbell Split Squat (all these names are in Coach Ron''s library)',
      (select count(*) from public.exercise_library where created_by = '136394ed-f108-4283-bcb7-310a1ac6cbc8' and name = any (array['Split Squat'])) = 1),
    ('PREVIEW Box Squat -> Barbell Box Squat (all these names are in Coach Ron''s library)',
      (select count(*) from public.exercise_library where created_by = '136394ed-f108-4283-bcb7-310a1ac6cbc8' and name = any (array['Box Squat'])) = 1),
    ('PREVIEW Lat Pulldown -> Cable Lat Pulldown (all these names are in Coach Ron''s library)',
      (select count(*) from public.exercise_library where created_by = '136394ed-f108-4283-bcb7-310a1ac6cbc8' and name = any (array['Lat Pulldown'])) = 1),
    ('the four FitPros exercises are in Coach Ron''s library',
      (select count(*) from public.exercise_library where created_by = '136394ed-f108-4283-bcb7-310a1ac6cbc8' and name in ('Sissy Squat', 'Thoracic Extension (Quadruped)', 'Handcuff W Rotation', 'Incline Iso Lateral Chest Press')) = 4),
    ('step 111 is not already applied (the merge log is not there yet)',
      to_regclass('public.exercise_catalog_merge_log') is null)
) as checks(check_name, ok);
