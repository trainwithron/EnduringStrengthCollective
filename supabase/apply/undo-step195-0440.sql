-- UNDO step 195 (0440). Run only if no package was made with the new builder yet (a 0-session package would break the old limits).
begin;
alter table public.coach_packages drop constraint if exists coach_packages_kind_check, drop constraint if exists coach_packages_price_cents_check, drop constraint if exists coach_packages_checkin_weeks_check;
alter table public.coach_packages drop column if exists kind, drop column if exists price_cents, drop column if exists checkin_weeks;
alter table public.coach_packages drop constraint if exists coach_packages_sessions_granted_check, add constraint coach_packages_sessions_granted_check check (sessions_granted > 0);
alter table public.coach_packages drop constraint if exists coach_packages_sessions_per_week_check, add constraint coach_packages_sessions_per_week_check check (sessions_per_week > 0);
alter table public.credit_purchases drop constraint if exists credit_purchases_credits_purchased_check, add constraint credit_purchases_credits_purchased_check check (credits_purchased > 0);
alter table public.subscription_credit_grants drop constraint if exists subscription_credit_grants_credits_granted_check, add constraint subscription_credit_grants_credits_granted_check check (credits_granted > 0);
commit;
-- The two purchase functions keep accepting 0 (harmless: nothing sends 0 once the columns are gone).
