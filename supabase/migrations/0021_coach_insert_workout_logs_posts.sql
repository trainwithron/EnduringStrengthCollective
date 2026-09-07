-- ============================================================================
-- BUG FIX: same gap as 0020, one step further down the same flow. Completing
-- a session a coach started on a client's behalf also inserts a
-- workout_logs row and a feed post authored as that client — both of those
-- INSERT policies were still athlete-only, so finishing a coach-logged
-- session 403'd on the very last step.
-- ============================================================================
drop policy if exists "workout_logs_insert_own" on public.workout_logs;
create policy "workout_logs_insert_own_or_coach"
  on public.workout_logs for insert
  to authenticated
  with check (
    (athlete_id = auth.uid() or public.is_group_coach(group_id))
    and public.is_group_member(group_id)
  );

-- Scoped to workout_summary only — a coach completing a client's in-person
-- session needs to post that summary as them, but should never be able to
-- author a free-text user_post in someone else's name. That'd be real
-- impersonation, not oversight.
drop policy if exists "posts_insert_members" on public.posts;
create policy "posts_insert_own_or_coach_summary"
  on public.posts for insert
  to authenticated
  with check (
    (
      author_id = auth.uid()
      or (public.is_group_coach(group_id) and post_type = 'workout_summary')
    )
    and public.is_group_member(group_id)
  );
