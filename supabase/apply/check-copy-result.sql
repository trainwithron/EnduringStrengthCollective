-- READ-ONLY. Run after step 30 and LOOK at it before step 31: the original program and its copy, side by side. The two rows must show the same numbers.
with pair as (
  select 'original (Main Group)' as which, '5b8a8a3a-344d-4192-a892-f74494fff9ab'::uuid as program_id
  union all
  select 'copy (The Home Team)', (select id from public.programs where group_id = '060017b5-e613-4204-a101-c6a14c3a9630' and name = 'christmas_abs_program' order by created_at desc limit 1)
)
select p.which,
  (select count(*) from public.workouts w where w.program_id = p.program_id) as workouts,
  (select count(*) from public.group_workout_exercises x join public.workouts w on w.id = x.workout_id where w.program_id = p.program_id) as exercises,
  (select count(*) from public.group_workout_exercise_sets s join public.group_workout_exercises x on x.id = s.group_workout_exercise_id join public.workouts w on w.id = x.workout_id where w.program_id = p.program_id) as sets,
  (select count(*) from public.workout_notes n join public.workouts w on w.id = n.workout_id where w.program_id = p.program_id) as notes,
  (select count(*) from public.exercise_progressions q where q.program_id = p.program_id) as progressions
from pair p;
