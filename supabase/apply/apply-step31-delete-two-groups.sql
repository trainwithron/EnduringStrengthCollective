-- STEP 31: delete Main Group and the stray Coast to Coast group (only after the copy is checked); everything in them is first saved in cleanup_backups
--
-- !! DELETES two groups. Run steps 26 and 30 first and check the copy. It refuses by itself if either group has a client, a logged workout, a booking, a session record, a purchase or a balance, or if the copy is missing or does not match.
--
-- Run apply-precheck first (every row ok = true). Then paste THIS file and run it once.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."
-- AFTERWARDS: Main Group (in Coast2Coast Fitness) and the stray Coast to Coast group (in Enduring Strength Co.) are gone. Their programs, workouts and members were saved as one record in cleanup_backups first. The copy of christmas_abs_program lives on in The Home Team.
-- ON ERROR: it is all or nothing, so nothing was applied. Run   rollback;   once, copy the red error text, and send it back. Do not run the file again.
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

do $guard$
begin
  if not (((select count(*) from public.groups where id in ('b292055b-edc6-4171-ad2b-a89d65dcd8db', 'c368ab0b-ccab-442e-a42e-38fb22293182')) = 2)) then
    raise exception 'Step 31 (delete-two-groups) looks already applied, or the database is not in the state it expects. Nothing was changed. Run the precheck file and send Spot the result.';
  end if;
end
$guard$;

-- ====================================================================================================
-- delete-two-groups: one-time data change
-- ====================================================================================================

-- Deletes the two groups Ron chose to remove: Main Group (Coast2Coast Fitness, its program is now copied into The Home Team) and the stray "Coast to Coast"
-- group (Enduring Strength Co., an unused 4-week program). It refuses, and nothing is deleted, if either group has a client, a logged workout, a booking, a
-- session record, a purchase or a session balance, or if the copy in The Home Team is missing or does not match. Before deleting it saves everything in both
-- groups (the groups, programs, workouts, exercises, sets, notes, progressions, memberships, wellness check-ins, view state and Spotter dismissals) as one record in cleanup_backups, so it can be restored by hand.
create table if not exists public.cleanup_backups (
  id uuid primary key default uuid_generate_v4(),
  taken_at timestamptz not null default now(),
  label text not null,
  payload jsonb not null
);
alter table public.cleanup_backups enable row level security;
revoke all on public.cleanup_backups from public, anon, authenticated;
do $del$
declare
  g uuid[] := array['b292055b-edc6-4171-ad2b-a89d65dcd8db', 'c368ab0b-ccab-442e-a42e-38fb22293182']::uuid[];
  copy_id uuid;
  a int; b int; c int; d int; e int; f int;
begin
  if exists (select 1 from public.group_memberships where group_id = any (g) and role = 'athlete') then raise exception 'One of the groups has a client, so nothing was deleted.'; end if;
  if exists (select 1 from public.workout_logs where group_id = any (g)) then raise exception 'One of the groups has a logged workout, so nothing was deleted.'; end if;
  if exists (select 1 from public.bookings where group_id = any (g)) then raise exception 'One of the groups has a booking, so nothing was deleted.'; end if;
  if exists (select 1 from public.athlete_sessions where group_id = any (g)) then raise exception 'One of the groups has a session record, so nothing was deleted.'; end if;
  if exists (select 1 from public.credit_purchases where group_id = any (g)) then raise exception 'One of the groups has a purchase, so nothing was deleted.'; end if;
  if exists (select 1 from public.session_credits where group_id = any (g)) then raise exception 'One of the groups has a session balance, so nothing was deleted.'; end if;
  select id into copy_id from public.programs where group_id = '060017b5-e613-4204-a101-c6a14c3a9630' and name = 'christmas_abs_program' order by created_at desc limit 1;
  if copy_id is null then raise exception 'The copy of the program in The Home Team is missing, so nothing was deleted. Run the copy step first.'; end if;
  select count(*) into a from public.workouts where program_id = '5b8a8a3a-344d-4192-a892-f74494fff9ab';
  select count(*) into b from public.workouts where program_id = copy_id;
  select count(*) into c from public.group_workout_exercises x join public.workouts w on w.id = x.workout_id where w.program_id = '5b8a8a3a-344d-4192-a892-f74494fff9ab';
  select count(*) into d from public.group_workout_exercises x join public.workouts w on w.id = x.workout_id where w.program_id = copy_id;
  select count(*) into e from public.group_workout_exercise_sets s join public.group_workout_exercises x on x.id = s.group_workout_exercise_id join public.workouts w on w.id = x.workout_id where w.program_id = '5b8a8a3a-344d-4192-a892-f74494fff9ab';
  select count(*) into f from public.group_workout_exercise_sets s join public.group_workout_exercises x on x.id = s.group_workout_exercise_id join public.workouts w on w.id = x.workout_id where w.program_id = copy_id;
  if a <> b or c <> d or e <> f or a = 0 then raise exception 'The copy does not match the original, so nothing was deleted.'; end if;

  insert into public.cleanup_backups (label, payload)
  select 'delete Main Group and the stray Coast to Coast group, 2026-10-06', jsonb_build_object(
    'groups', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.groups x where x.id = any (g)),
    'memberships', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.group_memberships x where x.group_id = any (g)),
    'programs', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.programs x where x.group_id = any (g)),
    'progressions', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.exercise_progressions x where x.group_id = any (g)),
    'workouts', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.workouts x where x.group_id = any (g)),
    'exercises', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.group_workout_exercises x where x.group_id = any (g)),
    'sets', (select coalesce(jsonb_agg(to_jsonb(s)), '[]'::jsonb) from public.group_workout_exercise_sets s where s.group_workout_exercise_id in (select id from public.group_workout_exercises where group_id = any (g))),
    'notes', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.workout_notes x where x.group_id = any (g)),
    'wellness_checkins', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.wellness_checkins x where x.group_id = any (g)),
    'coach_view_state', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.coach_view_state x where x.group_id = any (g)),
    'programming_spotter_dismissals', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.programming_spotter_dismissals x where x.program_id in (select id from public.programs where group_id = any (g)))
  );

  delete from public.groups where id = any (g);
end
$del$;

commit;
