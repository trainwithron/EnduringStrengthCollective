-- Pins search_path on the three athlete_id auto-fill trigger functions
-- from 0065 — the Supabase linter flags a function-level mutable
-- search_path as a privilege-escalation vector (a caller with schema
-- create rights could shadow an unqualified table/function reference).
-- These functions only ever touch public.* and only run as insert
-- triggers, but pinning is free and closes the warning outright.

create or replace function public.set_workout_athlete_id()
returns trigger language plpgsql set search_path = public as $$
begin
  select athlete_id into new.athlete_id from public.programs where id = new.program_id;
  return new;
end;
$$;

create or replace function public.set_gwe_athlete_id()
returns trigger language plpgsql set search_path = public as $$
begin
  select athlete_id into new.athlete_id from public.workouts where id = new.workout_id;
  return new;
end;
$$;

create or replace function public.set_workout_notes_athlete_id()
returns trigger language plpgsql set search_path = public as $$
begin
  select athlete_id into new.athlete_id from public.workouts where id = new.workout_id;
  return new;
end;
$$;
