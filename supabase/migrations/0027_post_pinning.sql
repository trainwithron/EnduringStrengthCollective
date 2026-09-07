alter table public.posts add column pinned_at timestamptz;

create policy "posts_update_coach_pin" on public.posts for update
  to authenticated
  using (public.is_group_coach(group_id))
  with check (public.is_group_coach(group_id));
