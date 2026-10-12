-- RELEASE BL (FOUR EXERCISES ADDED TO COACH RON'S LIBRARY FOR THE FITPROS HISTORY; RUN ANY TIME): ONE paste. Steps 106 in order, all or nothing.
--
-- Paste this whole file into the Supabase SQL editor and run it once. It replaces the separate precheck and apply files for these steps (they stay as the fallback).
-- Every check from each step's precheck is built in as a guard in front of that step. If any check is false, the run stops with a message that names the step and the
-- failed check, and NOTHING is kept, so a second run after a refusal is safe.
-- WHAT YOU SHOULD SEE: first "Success" for the transaction, then a result table with one row per step and in_place = true on every row.
-- ON ERROR: run   rollback;   once, copy the red text, send it to Spot. Do not run it again.
-- AFTER STEP 106: Four new entries in Coach Ron's exercise library, and typing the FitPros spellings (Sissy Squats, Thoracic Extensions (Quadruped)) finds them. Nothing else changes.
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

-- ===== Release BL (four exercises added to Coach Ron's library for the FitPros history; run any time), step 106: add four exercises to Coach Ron's library (Sissy Squat, Thoracic Extension (Quadruped), Handcuff W Rotation, Incline Iso Lateral Chest Press) so the FitPros history links to real rows; undoable
do $g106$
declare
  failed text;
begin
  select string_agg(check_name, '; ') into failed from (
    values
      ('Coach Ron''s profile exists', exists (select 1 from public.profiles where id = '136394ed-f108-4283-bcb7-310a1ac6cbc8')),
      ('none of the four exercises is in Coach Ron''s library yet', not exists (select 1 from public.exercise_library where created_by = '136394ed-f108-4283-bcb7-310a1ac6cbc8' and lower(name) in ('sissy squat', 'thoracic extension (quadruped)', 'handcuff w rotation', 'incline iso lateral chest press')))
  ) as checks(check_name, ok) where not ok;
  if failed is not null then
    raise exception 'Release BL (four exercises added to Coach Ron''s library for the FitPros history; run any time), step 106 (add-fitpros-exercises) cannot run: this step looks already applied, or the database is not in the state it expects. Failed checks: %. NOTHING was changed (the whole bundle is all or nothing). If an earlier step was applied by hand, use the single-step files for the rest, and send Spot this message.', failed;
  end if;
end
$g106$;

insert into public.exercise_library (created_by, name, category, description)
select '136394ed-f108-4283-bcb7-310a1ac6cbc8', v.name, v.category, 'Added from the FitPros import. To be promoted to the shared catalog when it exists.'
from (values ('Sissy Squat', 'Legs'), ('Thoracic Extension (Quadruped)', 'Cardio/Mobility'), ('Handcuff W Rotation', 'Cardio/Mobility'), ('Incline Iso Lateral Chest Press', 'Push')) as v(name, category)
where not exists (select 1 from public.exercise_library l where l.created_by = '136394ed-f108-4283-bcb7-310a1ac6cbc8' and lower(l.name) = lower(v.name));

insert into public.exercise_aliases (coach_id, raw_name, exercise_name)
select '136394ed-f108-4283-bcb7-310a1ac6cbc8', v.raw_name, v.exercise_name
from (values ('Sissy Squats', 'Sissy Squat'), ('Thoracic Extensions (Quadruped)', 'Thoracic Extension (Quadruped)')) as v(raw_name, exercise_name)
where not exists (select 1 from public.exercise_aliases a where a.coach_id = '136394ed-f108-4283-bcb7-310a1ac6cbc8' and lower(a.raw_name) = lower(v.raw_name));

commit;

-- Read-only result (after the commit): every row must say in_place = true.
select step, what, in_place from (
  select 'step 106 (add-fitpros-exercises)' as step, 'add four exercises to Coach Ron''s library' as what, true as in_place
) as result order by step;
