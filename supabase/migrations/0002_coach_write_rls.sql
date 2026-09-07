-- ============================================================================
-- PATCH: Grant coaches write access to athlete logs (corrections/oversight)
-- ============================================================================

-- ATHLETE_SESSIONS -------------------------------------------------------
drop policy if exists "sessions_update_own" on public.athlete_sessions;
create policy "sessions_update_own_or_coach"
  on public.athlete_sessions for update
  to authenticated
  using (athlete_id = auth.uid() or public.is_group_coach(group_id))
  with check (athlete_id = auth.uid() or public.is_group_coach(group_id));

drop policy if exists "sessions_delete_own" on public.athlete_sessions;
create policy "sessions_delete_own_or_coach"
  on public.athlete_sessions for delete
  to authenticated
  using (athlete_id = auth.uid() or public.is_group_coach(group_id));

-- SESSION_EXERCISES -------------------------------------------------------
drop policy if exists "session_exercises_write_own" on public.session_exercises;
create policy "session_exercises_write_own_or_coach"
  on public.session_exercises for all
  to authenticated
  using (
    exists (
      select 1 from public.athlete_sessions s
      where s.id = session_exercises.session_id
        and (s.athlete_id = auth.uid() or public.is_group_coach(s.group_id))
    )
  )
  with check (
    exists (
      select 1 from public.athlete_sessions s
      where s.id = session_exercises.session_id
        and (s.athlete_id = auth.uid() or public.is_group_coach(s.group_id))
    )
  );

-- SET_LOGS -------------------------------------------------------
drop policy if exists "set_logs_write_own" on public.set_logs;
create policy "set_logs_write_own_or_coach"
  on public.set_logs for all
  to authenticated
  using (
    exists (
      select 1 from public.session_exercises se
      join public.athlete_sessions s on s.id = se.session_id
      where se.id = set_logs.session_exercise_id
        and (s.athlete_id = auth.uid() or public.is_group_coach(s.group_id))
    )
  )
  with check (
    exists (
      select 1 from public.session_exercises se
      join public.athlete_sessions s on s.id = se.session_id
      where se.id = set_logs.session_exercise_id
        and (s.athlete_id = auth.uid() or public.is_group_coach(s.group_id))
    )
  );

-- WORKOUT_LOGS -------------------------------------------------------
drop policy if exists "workout_logs_update_own" on public.workout_logs;
create policy "workout_logs_update_own_or_coach"
  on public.workout_logs for update
  to authenticated
  using (athlete_id = auth.uid() or public.is_group_coach(group_id))
  with check (athlete_id = auth.uid() or public.is_group_coach(group_id));

create policy "workout_logs_delete_coach"
  on public.workout_logs for delete
  to authenticated
  using (public.is_group_coach(group_id));
