-- Two independent fixes from the same conversation:
--
-- 1. workout_logs' total_volume/total_sets_completed/new_prs were
-- entirely client-computed and client-supplied on insert — nothing
-- server-side ever re-derived them from the real set_logs rows, so a
-- modified request could fabricate a PR or inflate volume with zero
-- server-side check. The real per-set data (weight/reps) was always
-- safe, written directly to set_logs as each set is logged — only the
-- separate summary fields on workout_logs were exposed. Fixed by moving
-- the computation itself server-side into a security-definer RPC and
-- removing the client's ability to insert this table directly at all —
-- complete_workout_session() is now the only way a workout_logs row can
-- ever be created, and it always computes the numbers itself from the
-- real set_logs, never trusting a client-supplied value.
--
-- 2. A client's logged session detail (real sets/reps/weights, coaching
-- notes) was only ever visible to the exact coach of that one group —
-- not an org owner/admin above them, and not a platform admin above
-- that. Extends the same cascade already used elsewhere in this schema
-- (is_org_admin_of_group) one level further with a new is_platform_admin()
-- helper, applied to every SELECT policy the full session-detail page
-- depends on: the session itself, its exercises, its logged sets, and
-- the exercise-level coaching notes/target sets from the program
-- template. Write access is untouched — only a real group coach can
-- still log or edit anything; this is read-only cascade.

create or replace function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select is_platform_admin from public.profiles where id = auth.uid()), false);
$$;

-- --- 1. Trusted server-side workout completion ---

create or replace function public.complete_workout_session(p_session_id uuid)
returns table(
  workout_log_id uuid,
  athlete_id uuid,
  group_id uuid,
  total_volume numeric,
  total_sets_completed int,
  new_prs text[]
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session record;
  v_completed_at timestamptz := now();
  v_duration int;
  v_total_volume numeric;
  v_total_sets int;
  v_new_prs text[];
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

  -- This session's best weight per exercise name vs. this athlete's
  -- all-time best from every OTHER completed session — same logic that
  -- used to run client-side, now computed only from real rows the server
  -- itself reads.
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

  insert into public.workout_logs (
    session_id, athlete_id, group_id, workout_id,
    total_duration_seconds, total_volume, total_sets_completed, new_prs, logged_by_coach
  ) values (
    p_session_id, v_session.athlete_id, v_session.group_id, v_session.workout_id,
    v_duration, v_total_volume, v_total_sets, coalesce(v_new_prs, '{}'), v_session.logged_by_coach
  )
  returning id into v_log_id;

  return query select v_log_id, v_session.athlete_id, v_session.group_id, v_total_volume, v_total_sets, coalesce(v_new_prs, '{}');
end;
$$;

grant execute on function public.complete_workout_session(uuid) to authenticated;

-- The RPC above is security definer and bypasses RLS entirely for its own
-- insert — so client INSERT access to this table is no longer needed for
-- the app to work, and removing it closes the raw-request bypass (someone
-- calling the REST insert directly instead of the RPC, with fabricated
-- numbers).
drop policy if exists "workout_logs_insert_own_or_coach" on public.workout_logs;

-- --- 2. Cascading read-only visibility: coach -> org owner/admin -> platform admin ---

drop policy if exists "sessions_select_own_or_coach" on public.athlete_sessions;
create policy "sessions_select_own_or_coach"
  on public.athlete_sessions for select
  to authenticated
  using (
    athlete_id = auth.uid()
    or is_group_coach(group_id)
    or is_org_admin_of_group(group_id)
    or is_platform_admin()
  );

drop policy if exists "session_exercises_select_own_or_coach" on public.session_exercises;
create policy "session_exercises_select_own_or_coach"
  on public.session_exercises for select
  to authenticated
  using (
    exists (
      select 1 from public.athlete_sessions s
      where s.id = session_exercises.session_id
        and (
          s.athlete_id = auth.uid()
          or is_group_coach(s.group_id)
          or is_org_admin_of_group(s.group_id)
          or is_platform_admin()
        )
    )
  );

drop policy if exists "set_logs_select_own_or_coach" on public.set_logs;
create policy "set_logs_select_own_or_coach"
  on public.set_logs for select
  to authenticated
  using (
    exists (
      select 1 from public.session_exercises se
      join public.athlete_sessions s on s.id = se.session_id
      where se.id = set_logs.session_exercise_id
        and (
          s.athlete_id = auth.uid()
          or is_group_coach(s.group_id)
          or is_org_admin_of_group(s.group_id)
          or is_platform_admin()
        )
    )
  );

-- Preserves the original per-client personal-program privacy condition
-- (a personal program — athlete_id not null — is only visible to that one
-- athlete or the group's own coach, never the rest of the group) for
-- ordinary members; org owners/admins and platform admins get an
-- unconditional cascade on top of that, same as everywhere else in this
-- migration, including into personal programs that aren't theirs to run
-- but are theirs to oversee.
drop policy if exists "gwe_select_members" on public.group_workout_exercises;
create policy "gwe_select_members"
  on public.group_workout_exercises for select
  to authenticated
  using (
    (is_group_member(group_id) and (athlete_id is null or athlete_id = auth.uid() or is_group_coach(group_id)))
    or is_org_admin_of_group(group_id)
    or is_platform_admin()
  );

drop policy if exists "gwes_select_members" on public.group_workout_exercise_sets;
create policy "gwes_select_members"
  on public.group_workout_exercise_sets for select
  to authenticated
  using (
    exists (
      select 1 from public.group_workout_exercises g
      where g.id = group_workout_exercise_sets.group_workout_exercise_id
        and (
          (is_group_member(g.group_id) and (g.athlete_id is null or g.athlete_id = auth.uid() or is_group_coach(g.group_id)))
          or is_org_admin_of_group(g.group_id)
          or is_platform_admin()
        )
    )
  );
