-- RELEASE CH (MOVING A CLIENT MOVES ALL OF THEIR RECORDS; PROGRAM-DAY AND SESSION EXERCISE NAMES CAN NEVER BE ONLY NUMBERS OR CARRY SETS AND REPS; RUN BEFORE THE CODE THAT GOES WITH IT IS LIVE): ONE paste. Steps 128, 129 in order, all or nothing.
--
-- Paste this whole file into the Supabase SQL editor and run it once. It replaces the separate precheck and apply files for these steps (they stay as the fallback).
-- Every check from each step's precheck is built in as a guard in front of that step. If any check is false, the run stops with a message that names the step and the
-- failed check, and NOTHING is kept, so a second run after a refusal is safe.
-- WHAT YOU SHOULD SEE: first "Success" for the transaction, then a result table with one row per step and in_place = true on every row.
-- ON ERROR: run   rollback;   once, copy the red text, send it to Spot. Do not run it again.
-- AFTER STEP 128: Nothing changes on screen until a client is moved. After that, the client's intake form, photos, goals, nutrition phases, check-ins, food log, body scans, consent, credit ledger and every other record of theirs go to the new group with them, instead of staying behind in the old one. The old group's own structures (who attended its group sessions, its package access, kiosk PINs and check-ins, game scores) stay.
-- AFTER STEP 129: Nothing changes on screen. From now on a program day or a logged session refuses an exercise whose name is only digits, commas, dots and spaces (10,10,10) or that carries its sets and reps (Sumo Squat 3x10). The rows already there (77 logged exercises and 1 program exercise) are not touched or deleted; an edit to one of those rows is refused until it is renamed or removed.
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

-- ===== Release CH (moving a client moves all of their records; program-day and session exercise names can never be only numbers or carry sets and reps; run BEFORE the code that goes with it is live), step 128: 0378 Moving a client to another group moves all of their records
do $g128$
declare
  failed text;
begin
  select string_agg(check_name, '; ') into failed from (
    values
      ('0378 is not already applied (the move does not yet find every table)', to_regprocedure('public.move_client_to_group(uuid, uuid, uuid)') is not null and pg_get_functiondef(to_regprocedure('public.move_client_to_group(uuid, uuid, uuid)')) not like '%information_schema.columns%'),
      ('the session coach notes and progression rules tables exist', to_regclass('public.session_coach_notes') is not null and to_regclass('public.exercise_progressions') is not null)
  ) as checks(check_name, ok) where not ok;
  if failed is not null then
    raise exception 'Release CH (moving a client moves all of their records; program-day and session exercise names can never be only numbers or carry sets and reps; run BEFORE the code that goes with it is live), step 128 (0378) cannot run: this step looks already applied, or the database is not in the state it expects. Failed checks: %. NOTHING was changed (the whole bundle is all or nothing). If an earlier step was applied by hand, use the single-step files for the rest, and send Spot this message.', failed;
  end if;
end
$g128$;

-- ====================================================================================================
-- migration 0378_move_client_moves_everything.sql
-- ====================================================================================================

-- Release CH: moving a client to another group now moves ALL of their records, not just the sixteen tables the function knew about. Before, a moved client left their intake form, progress photos, goals, nutrition
-- phases, check-ins, food log, body scans, consent, credit ledger and about forty other tables behind in the old group, where the new group's coach could not see them.
-- The function is replaced whole (live definition, same checks, same permissions): the sixteen tables it moved by name are still moved first, in the same order; then every other table that has both athlete_id and
-- group_id is found from the database itself and moved the same way, so a table added later is covered too. Left where they are on purpose: the old group's own structures (who attended its group sessions, its
-- package access, its kiosk PINs and check-ins, its game scores). The program's progression rules and the coach notes on moved sessions follow their program and session.
-- Re-runnable.
create or replace function public.move_client_to_group(p_athlete_id uuid, p_from_group_id uuid, p_to_group_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  r record;
  prev_role text := current_setting('request.jwt.claim.role', true);
begin
  if not public.is_group_coach(p_from_group_id) or not public.is_group_coach(p_to_group_id) then
    raise exception 'Must coach both the source and destination group.';
  end if;

  -- Both groups must be in the same organization (a coach who belongs to two organizations must not be able to carry a client, and their records, across the line between them),
  -- and the person moved must be a client of the source group (not a co-coach or an owner).
  if (select g.organization_id from public.groups g where g.id = p_from_group_id) is distinct from (select g.organization_id from public.groups g where g.id = p_to_group_id) then
    raise exception 'A client can only be moved between groups of the same organization.';
  end if;
  if not exists (select 1 from public.group_memberships where group_id = p_from_group_id and profile_id = p_athlete_id and role = 'athlete') then
    raise exception 'That person is not a client in the source group.';
  end if;

  -- A one-on-one space holds ONE client: say so plainly instead of failing later on a database rule.
  if public.is_one_on_one_group(p_to_group_id)
     and exists (select 1 from public.group_memberships where group_id = p_to_group_id and role = 'athlete' and profile_id <> p_athlete_id) then
    raise exception 'A one-on-one space holds one client, and this one already has theirs.';
  end if;

  if exists (
    select 1 from public.group_memberships
    where group_id = p_to_group_id and profile_id = p_athlete_id
  ) then
    raise exception 'This client is already a member of the destination group.';
  end if;

  update public.group_memberships set group_id = p_to_group_id
    where group_id = p_from_group_id and profile_id = p_athlete_id;

  -- The checks above are done and the move is allowed, so from here the rows are moved as the server (some tables have a guard that keeps a signed-in caller from changing where a row is filed, and would quietly
  -- put the old group back). The caller's own role is put back at the end.
  perform set_config('request.jwt.claim.role', 'service_role', true);

  update public.workout_logs set group_id = p_to_group_id
    where group_id = p_from_group_id and athlete_id = p_athlete_id;
  update public.session_credits set group_id = p_to_group_id
    where group_id = p_from_group_id and athlete_id = p_athlete_id;
  update public.body_weight_logs set group_id = p_to_group_id
    where group_id = p_from_group_id and athlete_id = p_athlete_id;
  update public.athlete_notes set group_id = p_to_group_id
    where group_id = p_from_group_id and athlete_id = p_athlete_id;
  update public.client_habits set group_id = p_to_group_id
    where group_id = p_from_group_id and athlete_id = p_athlete_id;
  update public.daily_macros set group_id = p_to_group_id
    where group_id = p_from_group_id and athlete_id = p_athlete_id;
  update public.workout_assignments set group_id = p_to_group_id
    where group_id = p_from_group_id and athlete_id = p_athlete_id;
  update public.bookings set group_id = p_to_group_id
    where group_id = p_from_group_id and athlete_id = p_athlete_id;
  update public.athlete_sessions set group_id = p_to_group_id
    where group_id = p_from_group_id and athlete_id = p_athlete_id;
  update public.meal_plans set group_id = p_to_group_id
    where group_id = p_from_group_id and athlete_id = p_athlete_id;
  update public.athlete_exercise_overrides set group_id = p_to_group_id
    where group_id = p_from_group_id and athlete_id = p_athlete_id;
  update public.credit_purchases set group_id = p_to_group_id
    where group_id = p_from_group_id and athlete_id = p_athlete_id;
  update public.subscription_credit_grants set group_id = p_to_group_id
    where group_id = p_from_group_id and athlete_id = p_athlete_id;
  update public.membership_subscriptions set group_id = p_to_group_id
    where group_id = p_from_group_id and athlete_id = p_athlete_id;

  update public.programs set group_id = p_to_group_id
    where group_id = p_from_group_id and athlete_id = p_athlete_id;
  update public.workouts set group_id = p_to_group_id
    where group_id = p_from_group_id and athlete_id = p_athlete_id;
  update public.group_workout_exercises set group_id = p_to_group_id
    where group_id = p_from_group_id and athlete_id = p_athlete_id;
  update public.workout_notes set group_id = p_to_group_id
    where group_id = p_from_group_id and athlete_id = p_athlete_id;

  -- Everything else the database holds about this client in the old group: every table with both athlete_id and group_id that is not one of the above or one of the old group's own structures.
  for r in
    select c.table_name
    from information_schema.columns c
    join information_schema.columns g on g.table_schema = 'public' and g.table_name = c.table_name and g.column_name = 'group_id'
    join information_schema.tables t on t.table_schema = 'public' and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
    where c.table_schema = 'public' and c.column_name = 'athlete_id'
      and c.table_name <> all (array[
        'group_memberships', 'workout_logs', 'session_credits', 'body_weight_logs', 'athlete_notes', 'client_habits', 'daily_macros', 'workout_assignments', 'bookings', 'athlete_sessions',
        'meal_plans', 'athlete_exercise_overrides', 'credit_purchases', 'subscription_credit_grants', 'membership_subscriptions', 'programs', 'workouts', 'group_workout_exercises', 'workout_notes',
        'group_session_attendees', 'package_group_access', 'kiosk_pins', 'kiosk_checkins', 'game_score_entries'
      ])
    order by c.table_name
  loop
    execute format('update public.%I set group_id = $1 where group_id = $2 and athlete_id = $3', r.table_name)
      using p_to_group_id, p_from_group_id, p_athlete_id;
  end loop;

  -- Rows that follow a moved program or a moved session rather than carrying the client themselves.
  update public.exercise_progressions set group_id = p_to_group_id
    where group_id = p_from_group_id
      and program_id in (select id from public.programs where athlete_id = p_athlete_id and group_id = p_to_group_id);
  update public.session_coach_notes set group_id = p_to_group_id
    where group_id = p_from_group_id
      and session_id in (select id from public.athlete_sessions where athlete_id = p_athlete_id and group_id = p_to_group_id);

  delete from public.package_assignments
    where athlete_id = p_athlete_id
      and coach_package_id in (select id from public.coach_packages where group_id = p_from_group_id);

  perform set_config('request.jwt.claim.role', coalesce(prev_role, ''), true);
end;
$function$;

-- ===== Release CH (moving a client moves all of their records; program-day and session exercise names can never be only numbers or carry sets and reps; run BEFORE the code that goes with it is live), step 129: 0379 A program day or logged session exercise can never be named with only numbers or with its sets and reps
do $g129$
declare
  failed text;
begin
  select string_agg(check_name, '; ') into failed from (
    values
      ('0379 is not already applied (no rules yet)', not exists (select 1 from pg_constraint where conname in ('group_workout_exercises_name_not_digits', 'session_exercises_name_not_digits'))),
      ('the program exercises and session exercises tables exist', to_regclass('public.group_workout_exercises') is not null and to_regclass('public.session_exercises') is not null)
  ) as checks(check_name, ok) where not ok;
  if failed is not null then
    raise exception 'Release CH (moving a client moves all of their records; program-day and session exercise names can never be only numbers or carry sets and reps; run BEFORE the code that goes with it is live), step 129 (0379) cannot run: this step looks already applied, or the database is not in the state it expects. Failed checks: %. NOTHING was changed (the whole bundle is all or nothing). If an earlier step was applied by hand, use the single-step files for the rest, and send Spot this message.', failed;
  end if;
end
$g129$;

-- ====================================================================================================
-- migration 0379_names_never_numbers_in_sessions_and_programs.sql
-- ====================================================================================================

-- Release CH: the exercise name on a program day (group_workout_exercises) and on a logged session (session_exercises) can never be only digits, commas, dots and spaces ("10,10,10", "20"), or carry its sets
-- and reps ("Sumo Squat 3x10", "Squat 3 sets", "Row @7"). The same rule as the exercise library (0377). A wrongly laid-out file once saved the reps as the exercise names of 77 logged exercises.
-- NOT VALID: the rule applies to every new row and every rename from now on; the rows already there are left exactly as they are (nothing is deleted or changed). Re-runnable.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'group_workout_exercises_name_not_digits' and conrelid = 'public.group_workout_exercises'::regclass) then
    alter table public.group_workout_exercises add constraint group_workout_exercises_name_not_digits check (
      exercise_name !~ '^[0-9][0-9., ]*$' and exercise_name !~* '[0-9]+\s*[x\u00d7]\s*[0-9]+' and exercise_name !~* '[0-9]+\s*sets?\y' and exercise_name !~* '[0-9]+\s*reps?\s*$' and exercise_name !~ '@\s*[0-9][0-9.]*\s*$'
    ) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'session_exercises_name_not_digits' and conrelid = 'public.session_exercises'::regclass) then
    alter table public.session_exercises add constraint session_exercises_name_not_digits check (
      exercise_name !~ '^[0-9][0-9., ]*$' and exercise_name !~* '[0-9]+\s*[x\u00d7]\s*[0-9]+' and exercise_name !~* '[0-9]+\s*sets?\y' and exercise_name !~* '[0-9]+\s*reps?\s*$' and exercise_name !~ '@\s*[0-9][0-9.]*\s*$'
    ) not valid;
  end if;
end $$;

commit;

-- Read-only result (after the commit): every row must say in_place = true.
select step, what, in_place from (
  select 'step 128 (0378)' as step, '0378 Moving a client to another group moves all of their records' as what, not ((to_regprocedure('public.move_client_to_group(uuid, uuid, uuid)') is not null and pg_get_functiondef(to_regprocedure('public.move_client_to_group(uuid, uuid, uuid)')) not like '%information_schema.columns%')) as in_place
  union all
  select 'step 129 (0379)' as step, '0379 A program day or logged session exercise can never be named with only numbers or with its sets and reps' as what, not ((not exists (select 1 from pg_constraint where conname in ('group_workout_exercises_name_not_digits', 'session_exercises_name_not_digits')))) as in_place
) as result order by step;
