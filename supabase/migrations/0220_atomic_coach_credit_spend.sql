-- coach_credits_race_condition_sept30.md — checkAndSpendCoachCredits()
-- read a coach's balance in a plain SELECT, then spent it via a
-- SEPARATE adjust_coach_credits RPC call — no lock spanning the two, a
-- real TOCTOU race. Two truly concurrent requests (double-click, two
-- tabs, a script) could both read the same pre-spend balance, both
-- pass the check, both trigger a real Claude call, both then debit —
-- the stored balance stays non-negative (adjust_coach_credits's own
-- UPSERT already clamps at 0), but the platform delivers more AI
-- service than was actually paid for.
--
-- Fix, mirroring the pre-existing session_credits/book_session pattern
-- (check-and-spend inside one atomic plpgsql function, not two app-to-
-- database round-trips): a new spend_coach_credits() does the balance
-- read, the sufficiency check, AND the decrement in one statement,
-- under a row lock (`for update`) that makes a second concurrent call
-- genuinely wait for the first to commit before it can read the
-- now-reduced balance — not just hope the two round-trips don't
-- interleave.
--
-- adjust_coach_credits stays, but narrowed to service_role-only (the
-- Stripe webhook's grant path) — it was the vulnerable surface
-- specifically because a coach could call it directly to self-spend; a
-- coach now has no path to it at all, only the new atomic function.
create or replace function public.adjust_coach_credits(p_coach_id uuid, p_delta integer)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  new_balance int;
begin
  -- Null-safe on purpose (critical_null_auth_bypass_vulnerability_
  -- sept30.md's own lesson from earlier tonight): auth.role() returns
  -- NULL for a fully unauthenticated caller, and plain `<>` against NULL
  -- evaluates to NULL, which a plpgsql IF silently treats as false —
  -- `is distinct from` is null-safe and catches that case explicitly.
  if auth.role() is distinct from 'service_role' then
    raise exception 'Not authorized to adjust these credits';
  end if;

  insert into public.coach_credits (coach_id, balance, updated_at)
  values (p_coach_id, greatest(0, p_delta), now())
  on conflict (coach_id) do update set
    balance = greatest(0, public.coach_credits.balance + p_delta),
    updated_at = now()
  returning balance into new_balance;

  return new_balance;
end;
$$;

-- The real fix: a coach's own real-time spend, atomic. `for update`
-- locks the row for the rest of this transaction — a second concurrent
-- call against the same coach_id genuinely blocks here until the first
-- transaction commits (or rolls back), then reads the post-spend
-- balance, not a stale pre-spend one. A coach with no row yet (never
-- granted/backfilled) is treated as metered at balance 0, same as the
-- existing app-level default.
create or replace function public.spend_coach_credits(p_coach_id uuid, p_cost integer)
returns table(spent boolean, new_balance integer, unlimited boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance int;
  v_mode text;
begin
  if auth.uid() is null then
    raise exception 'Not authorized to spend these credits';
  elsif auth.uid() <> p_coach_id then
    raise exception 'Not authorized to spend these credits';
  end if;

  select c.balance, c.ai_access_mode into v_balance, v_mode
  from public.coach_credits c
  where c.coach_id = p_coach_id
  for update;

  if v_mode = 'unlimited' then
    return query select true, coalesce(v_balance, 0), true;
    return;
  end if;

  v_balance := coalesce(v_balance, 0);

  if v_balance < p_cost then
    return query select false, v_balance, false;
    return;
  end if;

  update public.coach_credits c
  set balance = c.balance - p_cost, updated_at = now()
  where c.coach_id = p_coach_id
  returning c.balance into v_balance;

  return query select true, v_balance, false;
end;
$$;
