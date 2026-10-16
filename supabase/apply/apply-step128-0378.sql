-- STEP 128: 0378 Moving a client to another group moves all of their records
--
-- Run apply-precheck first (every row ok = true). Then paste THIS file and run it once.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."
-- AFTERWARDS: Nothing changes on screen until a client is moved. After that, the client's intake form, photos, goals, nutrition phases, check-ins, food log, body scans, consent, credit ledger and every other record of theirs go to the new group with them, instead of staying behind in the old one. The old group's own structures (who attended its group sessions, its package access, kiosk PINs and check-ins, game scores) stay.
-- ON ERROR: it is all or nothing, so nothing was applied. Run   rollback;   once, copy the red error text, and send it back. Do not run the file again.
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

do $guard$
begin
  if not ((to_regprocedure('public.move_client_to_group(uuid, uuid, uuid)') is not null and pg_get_functiondef(to_regprocedure('public.move_client_to_group(uuid, uuid, uuid)')) not like '%information_schema.columns%')) then
    raise exception 'Step 128 (0378) looks already applied, or the database is not in the state it expects. Nothing was changed. Run the precheck file and send Spot the result.';
  end if;
end
$guard$;

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

commit;
