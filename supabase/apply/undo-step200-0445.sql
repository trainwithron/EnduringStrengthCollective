-- UNDO step 200 (direct charges). Forgets which Stripe account each organization and client customer is on; nothing in Stripe itself is changed.
alter table public.coach_packages drop column if exists stripe_account_id;
drop table if exists public.stripe_connected_customers;
drop table if exists public.org_connect_accounts;
