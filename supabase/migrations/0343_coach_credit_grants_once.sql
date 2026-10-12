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
