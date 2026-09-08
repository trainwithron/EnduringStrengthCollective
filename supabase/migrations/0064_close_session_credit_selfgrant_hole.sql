-- Real, exploitable hole found during tonight's RLS audit: an athlete
-- could call adjust_session_credits directly (bypassing the UI entirely)
-- with an arbitrary positive delta on their own account and grant
-- themselves free sessions — confirmed live (Ben Athlete granted himself
-- 999 credits with one RPC call, reverted immediately after confirming).
-- Pre-existing, not introduced tonight, but it now directly undermines
-- the whole point of the new Stripe credit-pack purchase flow, so it's
-- closed here rather than left for later.
--
-- Fix: an athlete can only ever DECREASE their own balance directly
-- (spending a credit — booking a session). The only legitimate way a
-- client's own action increases their own balance is cancelling a real
-- confirmed booking, which now goes through the new
-- cancel_booking_and_refund_credit function below instead of the raw
-- RPC + a client-supplied +1. A coach (the manual +/- admin control) and
-- the Stripe webhook (service role, no auth.uid() to match against) are
-- both unaffected.
create or replace function public.adjust_session_credits(
  p_athlete_id uuid,
  p_group_id uuid,
  p_delta int
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  new_balance int;
begin
  if auth.uid() = p_athlete_id and p_delta > 0 then
    raise exception 'not authorized to increase your own session credits directly';
  end if;

  if auth.uid() <> p_athlete_id and not public.is_group_coach(p_group_id) then
    raise exception 'not authorized to adjust these session credits';
  end if;

  insert into public.session_credits (athlete_id, group_id, balance)
  values (p_athlete_id, p_group_id, greatest(0, p_delta))
  on conflict (athlete_id, group_id)
  do update set
    balance = greatest(0, public.session_credits.balance + p_delta),
    updated_at = now()
  returning balance into new_balance;

  return new_balance;
end;
$$;

-- Cancelling a booking legitimately refunds exactly 1 credit — bundled
-- into one atomic, self-verifying function (checks a real 'confirmed'
-- booking belonging to this athlete actually exists before crediting
-- anything back) instead of two separate client-driven steps, which is
-- exactly the gap that let a bare positive self-delta be called with no
-- real booking behind it at all.
create or replace function public.cancel_booking_and_refund_credit(p_booking_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_athlete_id uuid;
  v_group_id uuid;
  v_status text;
begin
  select athlete_id, group_id, status into v_athlete_id, v_group_id, v_status
  from public.bookings where id = p_booking_id;

  if v_athlete_id is null then
    raise exception 'booking not found';
  end if;
  if auth.uid() <> v_athlete_id and not public.is_group_coach(v_group_id) then
    raise exception 'not authorized to cancel this booking';
  end if;
  if v_status <> 'confirmed' then
    raise exception 'booking is not in a cancellable state';
  end if;

  update public.bookings set status = 'cancelled' where id = p_booking_id;

  insert into public.session_credits (athlete_id, group_id, balance)
  values (v_athlete_id, v_group_id, 1)
  on conflict (athlete_id, group_id)
  do update set balance = public.session_credits.balance + 1, updated_at = now();
end;
$$;

grant execute on function public.cancel_booking_and_refund_credit(uuid) to authenticated;
