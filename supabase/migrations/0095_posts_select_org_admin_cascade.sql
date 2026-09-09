-- Follow-up to 0094: Postgres RLS requires a row to pass an applicable
-- SELECT policy before UPDATE/DELETE can act on it at all (the DELETE
-- policy's USING clause alone isn't sufficient to make a row a candidate)
-- — found by trying to actually verify 0094 live: an org owner/admin with
-- no group_memberships row at all in a given group (a real, common case —
-- it's the exact scenario the whole cascading-visibility feature exists
-- for) passed the new DELETE grant but still deleted zero rows, because
-- posts_select_members only ever granted is_group_member(group_id).
drop policy if exists "posts_select_members" on public.posts;
create policy "posts_select_members"
  on public.posts for select
  to authenticated
  using (
    is_group_member(group_id)
    or is_org_admin_of_group(group_id)
    or is_platform_admin()
  );
