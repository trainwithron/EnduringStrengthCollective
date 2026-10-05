-- Workout logging data integrity, before real clients log every set.
--
-- 1. Completing a workout is idempotent. A lost response followed by a second
--    tap used to complete the session again: a duplicate workout_logs row, a
--    duplicate feed post, and (for coach-logged sessions) a second credit
--    deduction. Now the session row is locked, a repeat call returns the
--    existing log untouched, and workout_logs.session_id is unique.
-- 2. A completed workout can't be edited by the athlete from a stale tab or a
--    second device (their set_logs updates are rejected); the coach still can.
-- 3. Starting a workout is ONE atomic function. It was three separate inserts
--    (session, exercises, sets): a dropped signal in between left an empty
--    session that could never be restarted. The function is also idempotent
--    (an in-progress session for the same workout is reused and, if it was
--    left empty, filled in), which makes "Resume" work.

-- ---- 1. idempotent completion ----------------------------------------------

create unique index if not exists workout_logs_session_id_key
  on public.workout_logs (session_id)
  where session_id is not null;

do $$
declare
  v_def text;
begin
  select pg_get_functiondef(p.oid)
    into v_def
  from pg_proc p
  where p.proname = 'complete_workout_session'
    and p.pronamespace = 'public'::regnamespace;

  -- Lock the session row so two simultaneous completions serialize.
  v_def := replace(
    v_def,
    'select * into v_session from public.athlete_sessions where id = p_session_id;',
    'select * into v_session from public.athlete_sessions where id = p_session_id for update;'
  );

  -- Already completed: hand back the existing log, change nothing.
  v_def := replace(
    v_def,
    E'  v_duration := extract(epoch from (v_completed_at - v_session.started_at))::int;',
    E'  if v_session.status = ''completed'' then\n'
    || E'    return query\n'
    || E'      select l.id, l.athlete_id, l.group_id, l.total_volume, l.total_sets_completed::int, l.new_prs, ''{}''::text[], false\n'
    || E'      from public.workout_logs l\n'
    || E'      where l.session_id = p_session_id;\n'
    || E'    if found then\n'
    || E'      return;\n'
    || E'    end if;\n'
    || E'  end if;\n\n'
    || E'  v_duration := extract(epoch from (v_completed_at - v_session.started_at))::int;'
  );

  if v_def not like '%for update;%' or v_def not like '%v_session.status = ''completed''%' then
    raise exception 'complete_workout_session: expected text not found';
  end if;

  execute v_def;
end $$;

-- ---- 2. no athlete edits to a completed workout -----------------------------

create or replace function public.block_athlete_edits_to_completed_session()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status public.session_status;
  v_group uuid;
  v_historical boolean;
begin
  -- Internal/admin calls (no signed-in user) and the service role are not blocked.
  if auth.uid() is null or auth.role() = 'service_role' then
    return new;
  end if;

  select s.status, s.group_id, s.is_historical
    into v_status, v_group, v_historical
  from public.athlete_sessions s
  join public.session_exercises se on se.session_id = s.id
  where se.id = new.session_exercise_id;

  if v_status = 'completed' and not coalesce(v_historical, false)
     and not coalesce(public.is_group_coach(v_group), false) then
    raise exception 'This workout was already completed.';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_block_edits_to_completed_session on public.set_logs;
create trigger trg_block_edits_to_completed_session
  before update on public.set_logs
  for each row execute function public.block_athlete_edits_to_completed_session();

-- ---- 3. atomic, resumable start ---------------------------------------------

-- p_exercises: [{ group_workout_exercise_id, exercise_name, exercise_order,
--   movement_pattern_id, tracked_fields: [...], sets: [{ set_order, weight, reps }] }]
-- SECURITY INVOKER: the caller's row-level security applies exactly as it did
-- to the three separate inserts this replaces.
create or replace function public.start_workout_session(
  p_workout_id uuid,
  p_group_id uuid,
  p_athlete_id uuid,
  p_logged_by_coach boolean,
  p_session_type_id uuid,
  p_deduct_session_credit boolean,
  p_booking_id uuid,
  p_exercises jsonb
)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_session uuid;
  ex jsonb;
  st jsonb;
  v_exercise uuid;
begin
  select id into v_session
  from public.athlete_sessions
  where athlete_id = p_athlete_id
    and workout_id = p_workout_id
    and group_id = p_group_id
    and status = 'in_progress'
  order by started_at desc
  limit 1;

  if v_session is null then
    insert into public.athlete_sessions (
      workout_id, group_id, athlete_id, logged_by_coach, session_type_id, deduct_session_credit, booking_id
    )
    values (
      p_workout_id, p_group_id, p_athlete_id, coalesce(p_logged_by_coach, false),
      p_session_type_id, coalesce(p_deduct_session_credit, false), p_booking_id
    )
    returning id into v_session;
  end if;

  -- Fill in the exercises and sets if this session has none yet (a brand-new
  -- one, or a legacy one left empty by a dropped connection).
  if not exists (select 1 from public.session_exercises where session_id = v_session) then
    for ex in select * from jsonb_array_elements(coalesce(p_exercises, '[]'::jsonb))
    loop
      insert into public.session_exercises (
        session_id, group_workout_exercise_id, exercise_name, exercise_order, movement_pattern_id, tracked_fields
      )
      values (
        v_session,
        nullif(ex ->> 'group_workout_exercise_id', '')::uuid,
        ex ->> 'exercise_name',
        coalesce((ex ->> 'exercise_order')::int, 0),
        nullif(ex ->> 'movement_pattern_id', '')::uuid,
        coalesce(
          (select array_agg(t) from jsonb_array_elements_text(ex -> 'tracked_fields') t),
          array['reps', 'weight']
        )
      )
      returning id into v_exercise;

      for st in select * from jsonb_array_elements(coalesce(ex -> 'sets', '[]'::jsonb))
      loop
        insert into public.set_logs (session_exercise_id, set_order, weight, reps)
        values (
          v_exercise,
          coalesce((st ->> 'set_order')::int, 0),
          nullif(st ->> 'weight', '')::numeric,
          nullif(st ->> 'reps', '')::int
        );
      end loop;
    end loop;
  end if;

  return v_session;
end;
$$;

revoke execute on function public.start_workout_session(uuid, uuid, uuid, boolean, uuid, boolean, uuid, jsonb) from public, anon;
grant execute on function public.start_workout_session(uuid, uuid, uuid, boolean, uuid, boolean, uuid, jsonb) to authenticated, service_role;
