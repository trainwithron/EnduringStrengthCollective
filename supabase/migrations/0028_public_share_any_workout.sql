-- Widen public sharing from "only workouts with a PR" to "any completed
-- workout" — the post-workout celebration card now goes out for every
-- completed workout, not just PR ones, so the anon policies backing it
-- need to cover every workout_summary post, not just PR'd ones. Each
-- policy is still scoped only to rows behind a genuine workout_summary
-- post — never a blanket table-wide grant.
drop policy "posts_select_public_pr_share" on public.posts;
create policy "posts_select_public_workout_share" on public.posts for select
  to anon using (post_type = 'workout_summary');

drop policy "workout_logs_select_public_pr_share" on public.workout_logs;
create policy "workout_logs_select_public_workout_share" on public.workout_logs for select
  to anon using (
    id in (select workout_log_id from public.posts where post_type = 'workout_summary')
  );

drop policy "profiles_select_public_pr_share" on public.profiles;
create policy "profiles_select_public_workout_share" on public.profiles for select
  to anon using (
    id in (select author_id from public.posts where post_type = 'workout_summary')
  );

drop policy "groups_select_public_pr_share" on public.groups;
create policy "groups_select_public_workout_share" on public.groups for select
  to anon using (
    id in (select group_id from public.posts where post_type = 'workout_summary')
  );

drop policy "session_exercises_select_public_pr_share" on public.session_exercises;
create policy "session_exercises_select_public_workout_share" on public.session_exercises for select
  to anon using (
    session_id in (
      select wl.session_id from public.workout_logs wl
      join public.posts p on p.workout_log_id = wl.id
      where p.post_type = 'workout_summary'
    )
  );

drop policy "set_logs_select_public_pr_share" on public.set_logs;
create policy "set_logs_select_public_workout_share" on public.set_logs for select
  to anon using (
    session_exercise_id in (
      select se.id from public.session_exercises se
      join public.workout_logs wl on wl.session_id = se.session_id
      join public.posts p on p.workout_log_id = wl.id
      where p.post_type = 'workout_summary'
    )
  );
