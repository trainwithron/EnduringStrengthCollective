-- Package builder revamp (Ron, Oct 31: "the package builder needs a revamp"; mockup approved the same day). A package is one of four kinds, and its price is one plain number:
--   team      access to a training team (group_access_group_id): everyone runs the team's program week by week
--   program   their own copy of a program (default_program_id)
--   coaching  online coaching: a program built for them, check-ins every checkin_weeks weeks
--   sessions  in-person sessions (the old shape: sessions_granted per month or in a pack)
-- price_cents is what the client pays (a month, or once). Null keeps the old rule, rate_cents x sessions_granted, so every existing package reads exactly as before.
-- A team, program or coaching package grants no sessions, so sessions_granted may now be 0; a purchase of one is still recorded once, and simply adds no sessions.

alter table public.coach_packages add column if not exists kind text;
alter table public.coach_packages add column if not exists price_cents integer;
alter table public.coach_packages add column if not exists checkin_weeks integer;

alter table public.coach_packages drop constraint if exists coach_packages_kind_check;
alter table public.coach_packages add constraint coach_packages_kind_check check (kind is null or kind in ('team', 'program', 'coaching', 'sessions'));
alter table public.coach_packages drop constraint if exists coach_packages_price_cents_check;
alter table public.coach_packages add constraint coach_packages_price_cents_check check (price_cents is null or price_cents > 0);
alter table public.coach_packages drop constraint if exists coach_packages_checkin_weeks_check;
alter table public.coach_packages add constraint coach_packages_checkin_weeks_check check (checkin_weeks is null or checkin_weeks in (1, 2, 4));

alter table public.coach_packages drop constraint if exists coach_packages_sessions_granted_check;
alter table public.coach_packages add constraint coach_packages_sessions_granted_check check (sessions_granted >= 0);
alter table public.coach_packages drop constraint if exists coach_packages_sessions_per_week_check;
alter table public.coach_packages add constraint coach_packages_sessions_per_week_check check (sessions_per_week >= 0);

alter table public.credit_purchases drop constraint if exists credit_purchases_credits_purchased_check;
alter table public.credit_purchases add constraint credit_purchases_credits_purchased_check check (credits_purchased >= 0);
alter table public.subscription_credit_grants drop constraint if exists subscription_credit_grants_credits_granted_check;
alter table public.subscription_credit_grants add constraint subscription_credit_grants_credits_granted_check check (credits_granted >= 0);

-- Same as before (0331) except: 0 credits is allowed. The purchase is recorded once as always; sessions are added only when there are some.
create or replace function public.grant_purchase_once(p_event_id text, p_session_id text, p_athlete_id uuid, p_group_id uuid, p_package_id uuid, p_credits integer, p_amount_cents integer, p_note text)
 returns boolean
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not authorized';
  end if;
  if p_credits is null or p_credits < 0 then
    raise exception 'credits must not be negative';
  end if;

  begin
    insert into public.credit_purchases (stripe_event_id, stripe_checkout_session_id, athlete_id, group_id, coach_package_id, credits_purchased, amount_cents)
    values (p_event_id, p_session_id, p_athlete_id, p_group_id, p_package_id, p_credits, coalesce(p_amount_cents, 0));
  exception when unique_violation then
    return false;
  end;

  if p_credits > 0 then
    perform public.grant_session_credits(p_athlete_id, p_group_id, p_credits, 'purchased', p_note);
  end if;
  return true;
end;
$function$;

create or replace function public.grant_subscription_credits_once(p_event_id text, p_athlete_id uuid, p_group_id uuid, p_package_id uuid, p_credits integer, p_note text)
 returns boolean
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not authorized';
  end if;
  if p_credits is null or p_credits < 0 then
    raise exception 'credits must not be negative';
  end if;

  begin
    insert into public.subscription_credit_grants (stripe_event_id, athlete_id, group_id, coach_package_id, credits_granted)
    values (p_event_id, p_athlete_id, p_group_id, p_package_id, p_credits);
  exception when unique_violation then
    return false;
  end;

  if p_credits > 0 then
    perform public.grant_session_credits(p_athlete_id, p_group_id, p_credits, 'purchased', p_note);
  end if;
  return true;
end;
$function$;
