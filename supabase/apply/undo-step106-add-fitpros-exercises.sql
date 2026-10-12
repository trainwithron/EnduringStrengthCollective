-- UNDO for step 106 (add-fitpros-exercises). Only if step 106 is wrong. Removes the four entries and the two spelling aliases it added (only those, recognised by their note).
-- WHAT YOU SHOULD SEE: "Success. No rows returned."   Then tell Spot, and do not run the step again until Spot says why it failed.
begin;
delete from public.exercise_aliases where coach_id = '136394ed-f108-4283-bcb7-310a1ac6cbc8' and raw_name in ('Sissy Squats', 'Thoracic Extensions (Quadruped)') and exercise_name in ('Sissy Squat', 'Thoracic Extension (Quadruped)');
delete from public.exercise_library where created_by = '136394ed-f108-4283-bcb7-310a1ac6cbc8' and name in ('Sissy Squat', 'Thoracic Extension (Quadruped)', 'Handcuff W Rotation', 'Incline Iso Lateral Chest Press') and description like 'Added from the FitPros import.%';
commit;
