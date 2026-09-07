alter table public.group_workout_exercise_sets
  add column rep_min int,
  add column rep_max int check (rep_max is null or rep_min is null or rep_max >= rep_min);
