-- STEP 106: add four exercises to Coach Ron's library (Sissy Squat, Thoracic Extension (Quadruped), Handcuff W Rotation, Incline Iso Lateral Chest Press) so the FitPros history links to real rows; undoable
--
-- !! A one-time data change for Coach Ron's library ONLY. They are marked to be promoted to the shared catalog when it exists.
--
-- Run apply-precheck first (every row ok = true). Then paste THIS file and run it once.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."
-- AFTERWARDS: Four new entries in Coach Ron's exercise library, and typing the FitPros spellings (Sissy Squats, Thoracic Extensions (Quadruped)) finds them. Nothing else changes.
-- ON ERROR: it is all or nothing, so nothing was applied. Run   rollback;   once, copy the red error text, and send it back. Do not run the file again.
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

-- ====================================================================================================
-- add-fitpros-exercises: one-time data change
-- ====================================================================================================

insert into public.exercise_library (created_by, name, category, description)
select '136394ed-f108-4283-bcb7-310a1ac6cbc8', v.name, v.category, 'Added from the FitPros import. To be promoted to the shared catalog when it exists.'
from (values ('Sissy Squat', 'Legs'), ('Thoracic Extension (Quadruped)', 'Cardio/Mobility'), ('Handcuff W Rotation', 'Cardio/Mobility'), ('Incline Iso Lateral Chest Press', 'Push')) as v(name, category)
where not exists (select 1 from public.exercise_library l where l.created_by = '136394ed-f108-4283-bcb7-310a1ac6cbc8' and lower(l.name) = lower(v.name));

insert into public.exercise_aliases (coach_id, raw_name, exercise_name)
select '136394ed-f108-4283-bcb7-310a1ac6cbc8', v.raw_name, v.exercise_name
from (values ('Sissy Squats', 'Sissy Squat'), ('Thoracic Extensions (Quadruped)', 'Thoracic Extension (Quadruped)')) as v(raw_name, exercise_name)
where not exists (select 1 from public.exercise_aliases a where a.coach_id = '136394ed-f108-4283-bcb7-310a1ac6cbc8' and lower(a.raw_name) = lower(v.raw_name));

commit;
