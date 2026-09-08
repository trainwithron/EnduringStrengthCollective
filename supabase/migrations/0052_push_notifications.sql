-- Phase 4: real push notification infrastructure. A subscription is one
-- browser/device's push endpoint for one profile; a coach can select
-- their own clients' subscriptions (needed server-side to actually send)
-- but never anyone else's.
create table public.push_subscriptions (
  id uuid primary key default uuid_generate_v4(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth_key text not null,
  created_at timestamptz not null default now(),
  unique (profile_id, endpoint)
);

alter table public.push_subscriptions enable row level security;

create policy "push_subscriptions_own" on public.push_subscriptions for all
  to authenticated
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid());

create policy "push_subscriptions_select_coach" on public.push_subscriptions for select
  to authenticated
  using (
    exists (
      select 1
      from public.group_memberships gm_coach
      join public.group_memberships gm_athlete
        on gm_athlete.group_id = gm_coach.group_id
      where gm_coach.profile_id = auth.uid()
        and gm_coach.role = 'coach'
        and gm_athlete.profile_id = push_subscriptions.profile_id
        and gm_athlete.role = 'athlete'
    )
  );
