-- Quick Payment (mobile_more_tab_condensed_widget_hub_sept30.md) — a
-- coach-initiated one-off charge to a specific client, not tied to any
-- package/subscription. Deliberately a separate table from
-- credit_purchases: that table's own check (credits_purchased > 0)
-- doesn't fit a bare dollar charge with no session credits granted, and
-- conflating "credits granted" with "money received" would make every
-- credits_purchased-based query (the business dashboard included)
-- silently wrong for every quick payment recorded there.
create table public.coach_quick_payments (
  id uuid primary key default uuid_generate_v4(),
  stripe_event_id text not null unique,
  stripe_checkout_session_id text not null,
  coach_id uuid not null references public.profiles(id) on delete cascade,
  athlete_id uuid not null references public.profiles(id) on delete cascade,
  group_id uuid not null references public.groups(id) on delete cascade,
  amount_cents int not null check (amount_cents > 0),
  description text,
  created_at timestamptz not null default now()
);

create index coach_quick_payments_group_id_idx on public.coach_quick_payments(group_id);
create index coach_quick_payments_athlete_id_idx on public.coach_quick_payments(athlete_id);

alter table public.coach_quick_payments enable row level security;

create policy "coach_quick_payments_select_coach_or_athlete" on public.coach_quick_payments for select
  to authenticated using (coach_id = (select auth.uid()) or athlete_id = (select auth.uid()));
-- No authenticated insert/update/delete policy — only the service-role
-- webhook ever writes this table, same as credit_purchases.
