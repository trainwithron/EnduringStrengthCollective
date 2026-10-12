-- RELEASE AU (A COACH CREDIT PACK OR LIFT OFF GRANT IS RECORDED AND ADDED IN ONE STEP; RUN BEFORE THE CODE THAT USES IT DEPLOYS): ONE paste. Steps 89 in order, all or nothing.
--
-- Paste this whole file into the Supabase SQL editor and run it once. It replaces the separate precheck and apply files for these steps (they stay as the fallback).
-- Every check from each step's precheck is built in as a guard in front of that step. If any check is false, the run stops with a message that names the step and the
-- failed check, and NOTHING is kept, so a second run after a refusal is safe.
-- WHAT YOU SHOULD SEE: first "Success" for the transaction, then a result table with one row per step and in_place = true on every row.
-- ON ERROR: run   rollback;   once, copy the red text, send it to Spot. Do not run it again.
-- AFTER STEP 89: Nothing visible changes. Two new server-only functions exist. After the app update, a coach who pays for a credit pack or a Lift Off month always gets the credits, even if the first attempt hit a database error. Run this paste BEFORE the code that uses it deploys; until the code deploys nothing uses it.
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

-- ===== Release AU (a coach credit pack or Lift Off grant is recorded and added in one step; run BEFORE the code that uses it deploys), step 89: 0343 A coach's credit pack or Lift Off grant is recorded and added in one step (a failed add is retried instead of lost)
do $g89$
declare
  failed text;
begin
  select string_agg(check_name, '; ') into failed from (
    values
      ('0343 is not already applied (the credit-pack function does not exist yet)', to_regprocedure('public.grant_coach_credit_pack_once(text, text, uuid, integer, integer)') is null),
      ('the credit adjust function and both record tables exist', to_regprocedure('public.adjust_coach_credits(uuid, integer)') is not null and to_regclass('public.coach_credit_purchases') is not null and to_regclass('public.lift_off_credit_grants') is not null)
  ) as checks(check_name, ok) where not ok;
  if failed is not null then
    raise exception 'Release AU (a coach credit pack or Lift Off grant is recorded and added in one step; run BEFORE the code that uses it deploys), step 89 (0343) cannot run: this step looks already applied, or the database is not in the state it expects. Failed checks: %. NOTHING was changed (the whole bundle is all or nothing). If an earlier step was applied by hand, use the single-step files for the rest, and send Spot this message.', failed;
  end if;
end
$g89$;

-- ====================================================================================================
-- migration 0343_coach_credit_grants_once.sql
-- ====================================================================================================

-- Release AU: a coach's credit pack or Lift Off grant is recorded and added in ONE step.
-- Before, the payment event was recorded first and the credits added second, as two separate calls. If the second call failed, Stripe's retry found the record, stopped, and the coach had paid and
-- got nothing (the client-session version of this was fixed the same way in 0331). Now both happen inside one function: if the credits can't be added, the record is rolled back with them, so the
-- retry grants again; a repeat of an event that was fully handled changes nothing and answers false. Only the server can run them.

create or replace function public.grant_coach_credit_pack_once(
  p_event_id text,
  p_session_id text,
  p_coach_id uuid,
  p_credits integer,
  p_amount_cents integer
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.coach_credit_purchases (stripe_event_id, stripe_checkout_session_id, coach_id, credits_purchased, amount_cents)
  values (p_event_id, p_session_id, p_coach_id, p_credits, p_amount_cents)
  on conflict (stripe_event_id) do nothing;
  if not found then
    return false;
  end if;
  perform public.adjust_coach_credits(p_coach_id, p_credits);
  return true;
end;
$$;

create or replace function public.grant_lift_off_credits_once(
  p_event_id text,
  p_coach_id uuid,
  p_credits integer
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.lift_off_credit_grants (stripe_event_id, coach_id, credits_granted)
  values (p_event_id, p_coach_id, p_credits)
  on conflict (stripe_event_id) do nothing;
  if not found then
    return false;
  end if;
  perform public.adjust_coach_credits(p_coach_id, p_credits);
  return true;
end;
$$;

revoke execute on function public.grant_coach_credit_pack_once(text, text, uuid, integer, integer) from public, anon, authenticated;
revoke execute on function public.grant_lift_off_credits_once(text, uuid, integer) from public, anon, authenticated;
grant execute on function public.grant_coach_credit_pack_once(text, text, uuid, integer, integer) to service_role;
grant execute on function public.grant_lift_off_credits_once(text, uuid, integer) to service_role;

commit;

-- Read-only result (after the commit): every row must say in_place = true.
select step, what, in_place from (
  select 'step 89 (0343)' as step, '0343 A coach''s credit pack or Lift Off grant is recorded and added in one step' as what, not ((to_regprocedure('public.grant_coach_credit_pack_once(text, text, uuid, integer, integer)') is null)) as in_place
) as result order by step;
