-- A subscription-type package needs sessions_granted credits added every
-- billing cycle, not just once at signup — today's webhook only tracked
-- subscription status, never granted recurring credits at all. Kept as
-- its own table (not folded into credit_purchases) so "purchase revenue
-- this month" and "credits granted this month" never get conflated in
-- the business dashboard's income math — a renewal grants credits but
-- isn't a new purchase event.
create table public.subscription_credit_grants (
  stripe_event_id text primary key,
  athlete_id uuid not null references public.profiles(id) on delete cascade,
  group_id uuid not null references public.groups(id) on delete cascade,
  coach_package_id uuid references public.coach_packages(id),
  credits_granted int not null check (credits_granted > 0),
  created_at timestamptz not null default now()
);

alter table public.subscription_credit_grants enable row level security;

-- No authenticated insert/update/delete — service-role webhook only,
-- same as credit_purchases.
create policy "subscription_credit_grants_select_own_or_coach" on public.subscription_credit_grants for select
  to authenticated
  using (athlete_id = (select auth.uid()) or public.is_group_coach(group_id));
