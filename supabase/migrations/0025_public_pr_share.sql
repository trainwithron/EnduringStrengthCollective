-- Narrow, additive anon-role SELECT policies: an anonymous visitor can
-- only ever see the exact rows that make up a public PR celebration.
-- (Later widened to any workout_summary post by 0028_public_share_any_workout.)
create policy "posts_select_public_pr_share" on public.posts for select
  to anon using (
    post_type = 'workout_summary'
    and workout_log_id in (select id from public.workout_logs where coalesce(array_length(new_prs,1),0) > 0)
  );

create policy "workout_logs_select_public_pr_share" on public.workout_logs for select
  to anon using (coalesce(array_length(new_prs,1),0) > 0);

create policy "profiles_select_public_pr_share" on public.profiles for select
  to anon using (
    id in (select author_id from public.posts where post_type = 'workout_summary'
      and workout_log_id in (select id from public.workout_logs where coalesce(array_length(new_prs,1),0) > 0))
  );

create policy "groups_select_public_pr_share" on public.groups for select
  to anon using (
    id in (select group_id from public.posts where post_type = 'workout_summary'
      and workout_log_id in (select id from public.workout_logs where coalesce(array_length(new_prs,1),0) > 0))
  );
