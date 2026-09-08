-- Manually-entered monthly rate per client membership — powers the
-- Business dashboard's "Estimated MRR" figure before real Stripe billing
-- exists. No new RLS needed: the existing "memberships_update_coach"
-- policy on group_memberships already lets a coach update any column on
-- their own group's memberships.
alter table public.group_memberships
  add column monthly_rate numeric check (monthly_rate is null or monthly_rate >= 0);
