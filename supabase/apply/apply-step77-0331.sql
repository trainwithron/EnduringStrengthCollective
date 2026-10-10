-- STEP 77: 0331 A paid session pack or membership renewal records its payment event and grants the sessions in ONE database step (a failed grant can no longer leave a handled-looking event with no sessions)
--
-- Run apply-precheck first (every row ok = true). Then paste THIS file and run it once.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."
-- AFTERWARDS: Nothing changes for anyone today. Two server-only functions are added; the payment handler uses them once the new code is live.
-- ON ERROR: it is all or nothing, so nothing was applied. Run   rollback;   once, copy the red error text, and send it back. Do not run the file again.
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

do $guard$
begin
  if not ((to_regprocedure('public.grant_purchase_once(text, text, uuid, uuid, uuid, integer, integer, text)') is null)) then
    raise exception 'Step 77 (0331) looks already applied, or the database is not in the state it expects. Nothing was changed. Run the precheck file and send Spot the result.';
  end if;
end
$guard$;

-- ====================================================================================================
-- migration 0331_purchase_grants_once.sql
-- ====================================================================================================

-- A paid session pack or a membership renewal records its payment event and puts the sessions on the account in ONE step. Before, the webhook first wrote the "this event is handled"
-- row and then granted the sessions in a separate call; if the second call failed, Stripe's retry found the row, treated the event as done, and the client paid and never got
-- their sessions. These two functions do both inside one transaction: if the grant fails, the event row is rolled back with it and a retry grants again; a repeat of an event that
-- was fully handled changes nothing and returns false. Only the server (service role) can run them.
-- Requires 0063/0100-0102 (the purchase tables) and the session ledger (grant_session_credits, 0248).

create or replace function public.grant_purchase_once(
  p_event_id text,
  p_session_id text,
  p_athlete_id uuid,
  p_group_id uuid,
  p_package_id uuid,
  p_credits integer,
  p_amount_cents integer,
  p_note text
) returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not authorized';
  end if;
  if p_credits is null or p_credits <= 0 then
    raise exception 'credits must be positive';
  end if;

  begin
    insert into public.credit_purchases (stripe_event_id, stripe_checkout_session_id, athlete_id, group_id, coach_package_id, credits_purchased, amount_cents)
    values (p_event_id, p_session_id, p_athlete_id, p_group_id, p_package_id, p_credits, coalesce(p_amount_cents, 0));
  exception when unique_violation then
    return false;
  end;

  perform public.grant_session_credits(p_athlete_id, p_group_id, p_credits, 'purchased', p_note);
  return true;
end;
$function$;

create or replace function public.grant_subscription_credits_once(
  p_event_id text,
  p_athlete_id uuid,
  p_group_id uuid,
  p_package_id uuid,
  p_credits integer,
  p_note text
) returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not authorized';
  end if;
  if p_credits is null or p_credits <= 0 then
    raise exception 'credits must be positive';
  end if;

  begin
    insert into public.subscription_credit_grants (stripe_event_id, athlete_id, group_id, coach_package_id, credits_granted)
    values (p_event_id, p_athlete_id, p_group_id, p_package_id, p_credits);
  exception when unique_violation then
    return false;
  end;

  perform public.grant_session_credits(p_athlete_id, p_group_id, p_credits, 'purchased', p_note);
  return true;
end;
$function$;

revoke all on function public.grant_purchase_once(text, text, uuid, uuid, uuid, integer, integer, text) from public, anon, authenticated;
revoke all on function public.grant_subscription_credits_once(text, uuid, uuid, uuid, integer, text) from public, anon, authenticated;
grant execute on function public.grant_purchase_once(text, text, uuid, uuid, uuid, integer, integer, text) to service_role;
grant execute on function public.grant_subscription_credits_once(text, uuid, uuid, uuid, integer, text) to service_role;

commit;
