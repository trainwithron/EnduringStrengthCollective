-- Additive, nullable — existing credit_purchases/membership_subscriptions
-- rows from the old hardcoded-price flow have no package to point to.
-- Needed so the business dashboard can compute real income/MRR per
-- coach_package, and so a purchase's price is durably recorded even if
-- the coach later edits or archives the package.
alter table public.credit_purchases
  add column coach_package_id uuid references public.coach_packages(id);

alter table public.membership_subscriptions
  add column coach_package_id uuid references public.coach_packages(id),
  add column price_cents int;

create index credit_purchases_coach_package_id_idx on public.credit_purchases(coach_package_id);
create index membership_subscriptions_coach_package_id_idx on public.membership_subscriptions(coach_package_id);
