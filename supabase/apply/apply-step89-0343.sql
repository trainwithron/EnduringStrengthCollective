-- STEP 89: 0343 A coach's credit pack or Lift Off grant is recorded and added in one step (a failed add is retried instead of lost)
--
-- Run apply-precheck first (every row ok = true). Then paste THIS file and run it once.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."
-- AFTERWARDS: Nothing visible changes. Two new server-only functions exist. After the app update, a coach who pays for a credit pack or a Lift Off month always gets the credits, even if the first attempt hit a database error. Run this paste BEFORE the code that uses it deploys; until the code deploys nothing uses it.
-- ON ERROR: it is all or nothing, so nothing was applied. Run   rollback;   once, copy the red error text, and send it back. Do not run the file again.
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

do $guard$
begin
  if not ((to_regprocedure('public.grant_coach_credit_pack_once(text, text, uuid, integer, integer)') is null)) then
    raise exception 'Step 89 (0343) looks already applied, or the database is not in the state it expects. Nothing was changed. Run the precheck file and send Spot the result.';
  end if;
end
$guard$;

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
