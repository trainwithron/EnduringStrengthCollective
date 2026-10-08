-- Release Q: the name a coach typed for an exercise, shown on their program, while it stays linked to the ONE real exercise underneath.
--  * group_workout_exercises.display_name: null for almost every row. It is set only when the coach picks an exercise through one of their own aliases ("RFESS" for the Bulgarian split
--    squat). exercise_name keeps holding the real exercise, so history, personal records, last time, progression, the AI builder and the library all keep matching on it; only what is SHOWN
--    (the builder, the client's workout page and the logger) uses display_name when there is one.
--  * A length limit so it stays a name. Nothing else changes: no policy, no function, no other table. A client reads it through the policies they already have on their program's exercises.
-- New column only. Re-runnable.

alter table public.group_workout_exercises add column if not exists display_name text;

do $q$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'group_workout_exercises_display_name_len' and conrelid = 'public.group_workout_exercises'::regclass
  ) then
    alter table public.group_workout_exercises
      add constraint group_workout_exercises_display_name_len check (display_name is null or char_length(btrim(display_name)) between 1 and 120);
  end if;
end
$q$;

comment on column public.group_workout_exercises.display_name is 'The coach''s own name for the exercise, shown instead of exercise_name; set only when picked through an alias. Every lookup (history, records, progression) still uses exercise_name.';
