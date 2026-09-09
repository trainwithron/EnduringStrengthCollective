-- ClearChannelButton's own comment says "Org owner/admin only," and its
-- client-side visibility check looks for exactly that — but the real
-- posts_delete_own_or_coach policy only ever granted author_id = self or
-- is_group_coach(group_id). An org owner/admin who isn't also a real
-- per-group coach saw the button, clicked it, and the delete silently
-- affected zero rows — no Postgres error (a DELETE with a WHERE clause
-- matching nothing just deletes nothing), so the UI read this as success
-- and refreshed a channel that was never actually cleared.
--
-- Extends the grant to match the feature's own stated intent, using the
-- same cascade already established elsewhere in this schema.
drop policy if exists "posts_delete_own_or_coach" on public.posts;
create policy "posts_delete_own_or_coach"
  on public.posts for delete
  to authenticated
  using (
    author_id = auth.uid()
    or is_group_coach(group_id)
    or is_org_admin_of_group(group_id)
    or is_platform_admin()
  );
