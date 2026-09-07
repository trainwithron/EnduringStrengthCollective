-- Tracks when a coach last actually looked at Team Feed / Clients, per
-- group, so the sidebar can show a real "what's new since you last
-- checked" badge instead of a raw unread-forever count.
create table public.coach_view_state (
  coach_id uuid not null references public.profiles(id) on delete cascade,
  group_id uuid not null references public.groups(id) on delete cascade,
  feed_seen_at timestamptz,
  clients_seen_at timestamptz,
  primary key (coach_id, group_id)
);
alter table public.coach_view_state enable row level security;
create policy "coach_view_state_own" on public.coach_view_state for all
  to authenticated using (coach_id = auth.uid()) with check (coach_id = auth.uid());
