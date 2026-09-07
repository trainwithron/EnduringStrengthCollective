-- Computing a real estimated 1RM for the public PR card needs the actual
-- weight/reps behind the PR, not just the exercise name stored on
-- workout_logs.new_prs — these two additional anon policies expose only
-- session_exercises/set_logs rows belonging to a session that produced a
-- public PR post. (Later widened to any workout_summary session by
-- 0028_public_share_any_workout.)
create policy "session_exercises_select_public_pr_share" on public.session_exercises for select
  to anon using (
    session_id in (
      select wl.session_id from public.workout_logs wl
      where coalesce(array_length(wl.new_prs,1),0) > 0
    )
  );

create policy "set_logs_select_public_pr_share" on public.set_logs for select
  to anon using (
    session_exercise_id in (
      select se.id from public.session_exercises se
      join public.workout_logs wl on wl.session_id = se.session_id
      where coalesce(array_length(wl.new_prs,1),0) > 0
    )
  );
