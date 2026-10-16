-- Release CI: a day number is unique inside a week of a program (two days can no longer both be "Week 1, Day 1" when two tabs or a double click add a day at the same moment).
-- The app now reads the next free number from what is saved and retries when it loses a race. Needs every program to have only one day per number already (step 130 fixes the one program that had two). Re-runnable.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'workouts_program_week_day_key' and conrelid = 'public.workouts'::regclass) then
    alter table public.workouts add constraint workouts_program_week_day_key unique (program_id, week_number, day_index);
  end if;
end $$;
