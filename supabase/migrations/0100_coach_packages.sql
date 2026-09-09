-- Coach-configurable training packages: real per-coach pricing, replacing
-- the single global price-per-kind Stripe billing shipped earlier this
-- session (0063_stripe_checkout.sql). A coach can now define any number
-- of packages — e.g. five tiers by weekly session frequency, each with a
-- one-time and a subscription variant at different per-session rates
-- (a real example: 1x/week one-time at $105/session vs. 1x/week
-- subscription at $95/session) — rather than everyone sharing one env-var
-- price.
--
-- rate_cents is the PER-SESSION rate (matches how a coach actually thinks
-- about pricing); the real charge is rate_cents * sessions_granted.
-- sessions_per_week is a display-only tier label, deliberately decoupled
-- from sessions_granted (the actual credits a purchase/cycle grants) so a
-- package never has to assume a fixed weeks-per-month conversion.
--
-- stripe_product_id/stripe_price_id start null — populated server-side
-- after insert (this table is never written to directly by a client
-- component the way most coach-config tables are, because saving a
-- package has a real Stripe side effect; see app/api/coach/packages/route.ts).
create table public.coach_packages (
  id uuid primary key default uuid_generate_v4(),
  coach_id uuid not null references public.profiles(id) on delete cascade,
  group_id uuid not null references public.groups(id) on delete cascade,
  name text not null,
  sessions_per_week int not null check (sessions_per_week > 0),
  billing_type text not null check (billing_type in ('subscription', 'one_time')),
  sessions_granted int not null check (sessions_granted > 0),
  rate_cents int not null check (rate_cents > 0),
  is_active boolean not null default true,
  stripe_product_id text,
  stripe_price_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index coach_packages_coach_id_idx on public.coach_packages(coach_id);
create index coach_packages_group_id_idx on public.coach_packages(group_id);

alter table public.coach_packages enable row level security;

create policy "coach_packages_coach_manage" on public.coach_packages for all
  to authenticated
  using (coach_id = (select auth.uid()))
  with check (coach_id = (select auth.uid()));

-- is_client_of_coach is coach-wide (checks any shared group), not
-- group-scoped — matches the same table already used identically by
-- coach_availability_windows, pro_shop_links, referral_partners, and
-- coach_availability_exceptions, even though those also carry group_id.
create policy "coach_packages_client_select" on public.coach_packages for select
  to authenticated
  using (is_active and public.is_client_of_coach(coach_id));
