-- Athlete self-service account deletion needs to detach (not cascade)
-- from the tables that are really the COACH's record, not the
-- athlete's own data — otherwise a raw auth.admin.deleteUser() call
-- silently destroys the coach's own logged-workout history, revenue
-- audit trail, and private notes. Same "on delete set null instead of
-- cascade" precedent already proven for workout templates in
-- 0035_preserve_history_on_workout_delete.sql, applied here to the
-- athlete side. Constraint names confirmed via pg_constraint
-- immediately before writing this file.

alter table public.credit_purchases alter column athlete_id drop not null;
alter table public.credit_purchases drop constraint credit_purchases_athlete_id_fkey;
alter table public.credit_purchases add constraint credit_purchases_athlete_id_fkey
  foreign key (athlete_id) references public.profiles(id) on delete set null;

alter table public.workout_logs alter column athlete_id drop not null;
alter table public.workout_logs drop constraint workout_logs_athlete_id_fkey;
alter table public.workout_logs add constraint workout_logs_athlete_id_fkey
  foreign key (athlete_id) references public.profiles(id) on delete set null;

alter table public.athlete_sessions alter column athlete_id drop not null;
alter table public.athlete_sessions drop constraint athlete_sessions_athlete_id_fkey;
alter table public.athlete_sessions add constraint athlete_sessions_athlete_id_fkey
  foreign key (athlete_id) references public.profiles(id) on delete set null;

alter table public.athlete_notes alter column athlete_id drop not null;
alter table public.athlete_notes drop constraint athlete_notes_athlete_id_fkey;
alter table public.athlete_notes add constraint athlete_notes_athlete_id_fkey
  foreign key (athlete_id) references public.profiles(id) on delete set null;
