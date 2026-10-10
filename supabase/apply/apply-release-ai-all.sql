-- RELEASE AI (A PAYMENT AND ITS SESSIONS ARE RECORDED IN ONE STEP; RUN BEFORE THE CODE THAT USES IT DEPLOYS): ONE paste. Steps 77 in order, all or nothing.
--
-- Paste this whole file into the Supabase SQL editor and run it once. It replaces the separate precheck and apply files for these steps (they stay as the fallback).
-- Every check from each step's precheck is built in as a guard in front of that step. If any check is false, the run stops with a message that names the step and the
-- failed check, and NOTHING is kept, so a second run after a refusal is safe.
-- WHAT YOU SHOULD SEE: first "Success" for the transaction, then a result table with one row per step and in_place = true on every row.
-- ON ERROR: run   rollback;   once, copy the red text, send it to Spot. Do not run it again.
-- AFTER STEP 77: Nothing changes for anyone today. Two server-only functions are added; the payment handler uses them once the new code is live.
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

-- ===== Release AI (a payment and its sessions are recorded in one step; run BEFORE the code that uses it deploys), step 77: 0331 A paid session pack or membership renewal records its payment event and grants the sessions in ONE database step (a failed grant can no longer leave a handled-looking event with no sessions)
do $g77$
declare
  failed text;
begin
  select string_agg(check_name, '; ') into failed from (
    values
      ('0331 is not already applied (grant_purchase_once does not exist yet)', to_regprocedure('public.grant_purchase_once(text, text, uuid, uuid, uuid, integer, integer, text)') is null),
      ('the purchase tables exist', to_regclass('public.credit_purchases') is not null and to_regclass('public.subscription_credit_grants') is not null),
      ('the session ledger grant function exists (0248)', to_regprocedure('public.grant_session_credits(uuid, uuid, integer, text, text)') is not null)
  ) as checks(check_name, ok) where not ok;
  if failed is not null then
    raise exception 'Release AI (a payment and its sessions are recorded in one step; run BEFORE the code that uses it deploys), step 77 (0331) cannot run: this step looks already applied, or the database is not in the state it expects. Failed checks: %. NOTHING was changed (the whole bundle is all or nothing). If an earlier step was applied by hand, use the single-step files for the rest, and send Spot this message.', failed;
  end if;
end
$g77$;

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

-- Read-only result (after the commit): every row must say in_place = true.
select step, what, in_place from (
  select 'step 77 (0331)' as step, '0331 A paid session pack or membership renewal records its payment event and grants the sessions in ONE database step' as what, not ((to_regprocedure('public.grant_purchase_once(text, text, uuid, uuid, uuid, integer, integer, text)') is null)) as in_place
) as result order by step;
