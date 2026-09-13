-- Group record book (record_holders_hall_of_fame_scoping memory) — a
-- permanent, append-only record of the group's all-time bests, distinct
-- from the live/current leaderboard. Scoped to the direct-group tier
-- only this pass: world-record benchmarking needs a real, sourced
-- content bank not yet compiled, and "local area" has no geographic
-- data anywhere in this schema to build on — both explicitly deferred,
-- not silently dropped.
--
-- V1 tracks WEIGHT only, not every tracked field — reps/time/distance/
-- height records need a per-exercise "which direction wins" tag (a
-- sprint wants lower time, a plank hold wants higher time; there's no
-- correct blanket default), which Ron's own resolution defers to a
-- future exercise-library content pass ("tag them as we build out the
-- library"). Weight never has that ambiguity — higher always wins — so
-- it's the one field this pass can build without guessing.
--
-- Gender-split records were also resolved as wanted, but this schema
-- has NO gender/sex field anywhere (profiles, athlete_profile_details,
-- intake) — flagged the same honest way as the local-area tier rather
-- than silently defaulting or inventing a field for this pass.
create table public.exercise_records (
  id uuid primary key default uuid_generate_v4(),
  group_id uuid not null references public.groups(id) on delete cascade,
  exercise_name text not null,
  tracked_field text not null,
  direction text not null check (direction in ('higher_better', 'lower_better')),
  value numeric not null,
  athlete_id uuid not null references public.profiles(id) on delete cascade,
  set_log_id uuid references public.set_logs(id) on delete set null,
  achieved_at timestamptz not null,
  superseded_at timestamptz
);
create index exercise_records_group_id_idx on public.exercise_records(group_id);
create index exercise_records_athlete_id_idx on public.exercise_records(athlete_id);
-- The "current holder" for any (group, exercise, field) is the one row
-- with superseded_at is null — enforced as a real uniqueness constraint,
-- not just an app-level convention, so two rows can never both claim to
-- be the live record at once.
create unique index exercise_records_current_holder_idx
  on public.exercise_records (group_id, exercise_name, tracked_field)
  where superseded_at is null;

alter table public.exercise_records enable row level security;
create policy "exercise_records_select_members" on public.exercise_records for select
  to authenticated using (public.is_group_member(group_id));
-- No authenticated write policy at all, deliberately — the only writer
-- is complete_workout_session, a security-definer function that runs
-- with the table owner's privileges (bypassing RLS the same way every
-- other write inside that function already does for workout_logs). A
-- record is only ever created by a real completed set beating the
-- current holder, never a direct client write.

-- Extend the existing PR-detection pass with group-record detection,
-- additively — every existing line is unchanged; the new block runs
-- after the personal-PR computation and returns one more column.
drop function public.complete_workout_session(uuid);
create function public.complete_workout_session(p_session_id uuid)
returns table(
  workout_log_id uuid,
  athlete_id uuid,
  group_id uuid,
  total_volume numeric,
  total_sets_completed integer,
  new_prs text[],
  new_records text[]
)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_session record;
  v_completed_at timestamptz := now();
  v_duration int;
  v_total_volume numeric;
  v_total_sets int;
  v_new_prs text[];
  v_new_records text[];
  v_log_id uuid;
begin
  select * into v_session from public.athlete_sessions where id = p_session_id;
  if not found then
    raise exception 'session not found';
  end if;

  if auth.uid() <> v_session.athlete_id and not public.is_group_coach(v_session.group_id) then
    raise exception 'not authorized to complete this session';
  end if;

  v_duration := extract(epoch from (v_completed_at - v_session.started_at))::int;

  update public.athlete_sessions
    set status = 'completed', completed_at = v_completed_at, duration_seconds = v_duration
    where id = p_session_id;

  select coalesce(sum(sl.weight * sl.reps), 0), count(*)
    into v_total_volume, v_total_sets
  from public.set_logs sl
  join public.session_exercises se on se.id = sl.session_exercise_id
  where se.session_id = p_session_id and sl.status = 'completed';

  with session_best as (
    select se.exercise_name as name, max(sl.weight) as best
    from public.set_logs sl
    join public.session_exercises se on se.id = sl.session_exercise_id
    where se.session_id = p_session_id and sl.status = 'completed'
    group by se.exercise_name
  ),
  prior_best as (
    select se.exercise_name as name, max(sl.weight) as best
    from public.set_logs sl
    join public.session_exercises se on se.id = sl.session_exercise_id
    join public.athlete_sessions asx on asx.id = se.session_id
    where asx.athlete_id = v_session.athlete_id
      and se.session_id <> p_session_id
      and sl.status = 'completed'
    group by se.exercise_name
  )
  select coalesce(array_agg(sb.name), '{}')
    into v_new_prs
  from session_best sb
  join prior_best pb on pb.name = sb.name
  where sb.best > pb.best;

  -- Group-record detection (weight only, see file header for why).
  with session_best_weight as (
    select se.exercise_name as name,
           max(sl.weight) as best,
           (array_agg(sl.id order by sl.weight desc nulls last))[1] as best_set_log_id
    from public.set_logs sl
    join public.session_exercises se on se.id = sl.session_exercise_id
    where se.session_id = p_session_id and sl.status = 'completed' and sl.weight is not null
    group by se.exercise_name
  ),
  current_records as (
    select exercise_name, value
    from public.exercise_records
    where exercise_records.group_id = v_session.group_id and tracked_field = 'weight' and superseded_at is null
  ),
  broken as (
    select sbw.name, sbw.best, sbw.best_set_log_id
    from session_best_weight sbw
    left join current_records cr on cr.exercise_name = sbw.name
    where cr.exercise_name is null or sbw.best > cr.value
  )
  select coalesce(array_agg(b.name), '{}') into v_new_records from broken b;

  update public.exercise_records
    set superseded_at = v_completed_at
    where exercise_records.group_id = v_session.group_id and tracked_field = 'weight' and superseded_at is null
      and exercise_name = any(v_new_records);

  with session_best_weight as (
    select se.exercise_name as name,
           max(sl.weight) as best,
           (array_agg(sl.id order by sl.weight desc nulls last))[1] as best_set_log_id
    from public.set_logs sl
    join public.session_exercises se on se.id = sl.session_exercise_id
    where se.session_id = p_session_id and sl.status = 'completed' and sl.weight is not null
    group by se.exercise_name
  ),
  current_records as (
    select exercise_name, value
    from public.exercise_records
    where exercise_records.group_id = v_session.group_id and tracked_field = 'weight' and superseded_at is null
  ),
  broken as (
    select sbw.name, sbw.best, sbw.best_set_log_id
    from session_best_weight sbw
    left join current_records cr on cr.exercise_name = sbw.name
    where cr.exercise_name is null or sbw.best > cr.value
  )
  insert into public.exercise_records (group_id, exercise_name, tracked_field, direction, value, athlete_id, set_log_id, achieved_at)
  select v_session.group_id, b.name, 'weight', 'higher_better', b.best, v_session.athlete_id, b.best_set_log_id, v_completed_at
  from broken b;

  insert into public.workout_logs (
    session_id, athlete_id, group_id, workout_id,
    total_duration_seconds, total_volume, total_sets_completed, new_prs, logged_by_coach
  ) values (
    p_session_id, v_session.athlete_id, v_session.group_id, v_session.workout_id,
    v_duration, v_total_volume, v_total_sets, coalesce(v_new_prs, '{}'), v_session.logged_by_coach
  )
  returning id into v_log_id;

  return query select v_log_id, v_session.athlete_id, v_session.group_id, v_total_volume, v_total_sets, coalesce(v_new_prs, '{}'), coalesce(v_new_records, '{}');
end;
$function$;
