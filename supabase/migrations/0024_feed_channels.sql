alter table public.posts
  add column channel text not null default 'general'
    check (channel in ('announcements', 'form_checks', 'pr_board', 'general'));

-- Backfill: route existing auto-generated PR celebrations to PR Board,
-- everything else stays General (the safe, no-surprises default).
update public.posts set channel = 'pr_board'
  where post_type = 'workout_summary'
    and workout_log_id in (
      select id from public.workout_logs where array_length(new_prs, 1) > 0
    );

-- Replace the insert policy: same author-or-coach-summary shape as
-- before, plus a channel gate — only a coach can author a user_post in
-- 'announcements'. Workout-summary posts are unaffected by channel.
drop policy "posts_insert_own_or_coach_summary" on public.posts;
create policy "posts_insert_own_or_coach_summary" on public.posts for insert
  to authenticated
  with check (
    public.is_group_member(group_id) and (
      (post_type = 'workout_summary' and (author_id = auth.uid() or public.is_group_coach(group_id)))
      or (post_type = 'user_post' and author_id = auth.uid()
          and (channel <> 'announcements' or public.is_group_coach(group_id)))
    )
  );
