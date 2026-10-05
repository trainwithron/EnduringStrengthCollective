-- Session credit ledger and "Assign sessions".
--
-- A coach gives a client a number of sessions with an optional note (for example "12 sessions, paid in person"),
-- with no purchase involved. The client's balance, the calendar and in-app booking then work exactly as they do for
-- a purchased package, because the balance is the same session_credits row.
--
-- Every change to a balance is recorded in session_credit_ledger (who, when, why, and the balance after), so a coach
-- can look back at "sold on this date, delivered since then". 0248 writes the other kinds of entry (delivered,
-- waived, booked, refund, adjusted); this migration creates the table, the single internal function that all of them
-- go through, and the assign action.

create table if not exists public.session_credit_ledger (
  id uuid primary key default uuid_generate_v4(),
  athlete_id uuid not null references public.profiles(id) on delete cascade,
  group_id uuid not null references public.groups(id) on delete cascade,
  kind text not null check (kind in ('assigned', 'purchased', 'booked', 'delivered', 'waived', 'refund', 'adjusted', 'opening', 'expired')),
  -- Signed: sessions added are positive, sessions used are negative. Waived entries are 0.
  amount int not null,
  balance_after int not null,
  note text,
  booking_id uuid references public.bookings(id) on delete set null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists session_credit_ledger_athlete_idx
  on public.session_credit_ledger (athlete_id, group_id, created_at desc);

alter table public.session_credit_ledger enable row level security;
-- Coaches of the group and the client themselves can read it; rows are written only by the functions below.
create policy "session_credit_ledger_select" on public.session_credit_ledger for select
  to authenticated
  using (athlete_id = (select auth.uid()) or public.is_group_coach(group_id));

-- Opening balances: existing balances have no history, so each starts with one row saying where it stood when the
-- ledger began.
insert into public.session_credit_ledger (athlete_id, group_id, kind, amount, balance_after, note)
select athlete_id, group_id, 'opening', balance, balance, 'Balance when the ledger started'
from public.session_credits
where not exists (
  select 1 from public.session_credit_ledger l
  where l.athlete_id = session_credits.athlete_id and l.group_id = session_credits.group_id
);

-- The ONE place a balance changes and a ledger row is written. No floor: a balance below zero means the client is
-- owed sessions-worth of training that has not been paid for yet, which a coach must be able to see rather than
-- have silently clamped to zero. Not callable by clients or coaches directly; the functions that call it do their
-- own authorization.
create or replace function public.apply_session_credit_change(
  p_athlete_id uuid,
  p_group_id uuid,
  p_delta int,
  p_kind text,
  p_note text default null,
  p_booking_id uuid default null,
  p_created_by uuid default null
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance int;
  v_grants boolean := p_delta > 0 and p_kind in ('assigned', 'purchased', 'adjusted');
begin
  insert into public.session_credits (athlete_id, group_id, balance, last_granted_at)
  values (p_athlete_id, p_group_id, p_delta, case when v_grants then now() else null end)
  on conflict (athlete_id, group_id)
  do update set
    balance = public.session_credits.balance + p_delta,
    last_granted_at = case when v_grants then now() else public.session_credits.last_granted_at end,
    updated_at = now()
  returning balance into v_balance;

  insert into public.session_credit_ledger (athlete_id, group_id, kind, amount, balance_after, note, booking_id, created_by)
  values (p_athlete_id, p_group_id, p_kind, p_delta, v_balance, nullif(trim(coalesce(p_note, '')), ''), p_booking_id,
          coalesce(p_created_by, auth.uid()));

  return v_balance;
end;
$$;

revoke all on function public.apply_session_credit_change(uuid, uuid, int, text, text, uuid, uuid) from public, anon, authenticated;

create or replace function public.assign_session_credits(
  p_athlete_id uuid,
  p_group_id uuid,
  p_amount int,
  p_note text default null
)
returns int
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.is_group_coach(p_group_id) then
    raise exception 'not authorized to assign sessions';
  end if;
  if p_amount is null or p_amount < 1 or p_amount > 500 then
    raise exception 'sessions to assign must be between 1 and 500';
  end if;
  if not exists (
    select 1 from public.group_memberships
    where group_id = p_group_id and profile_id = p_athlete_id and role = 'athlete'
  ) then
    raise exception 'that person is not a client in this group';
  end if;

  return public.apply_session_credit_change(p_athlete_id, p_group_id, p_amount, 'assigned', p_note, null, auth.uid());
end;
$$;

grant execute on function public.assign_session_credits(uuid, uuid, int, text) to authenticated;

-- Match the balance to what the client really has, for example back to zero for a client who ended up at -2 because
-- they pay elsewhere. Recorded in the ledger as an adjustment showing the change, the new balance, and who did it.
create or replace function public.set_session_balance(
  p_athlete_id uuid,
  p_group_id uuid,
  p_target int,
  p_note text default null
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current int;
  v_delta int;
begin
  if auth.uid() is null or not public.is_group_coach(p_group_id) then
    raise exception 'not authorized to set this balance';
  end if;
  if p_target is null or p_target < -500 or p_target > 500 then
    raise exception 'balance must be between -500 and 500';
  end if;
  if not exists (
    select 1 from public.group_memberships
    where group_id = p_group_id and profile_id = p_athlete_id and role = 'athlete'
  ) then
    raise exception 'that person is not a client in this group';
  end if;

  select balance into v_current from public.session_credits
    where athlete_id = p_athlete_id and group_id = p_group_id
    for update;
  v_current := coalesce(v_current, 0);
  v_delta := p_target - v_current;
  if v_delta = 0 then
    return v_current;
  end if;

  return public.apply_session_credit_change(
    p_athlete_id, p_group_id, v_delta, 'adjusted',
    coalesce(nullif(trim(coalesce(p_note, '')), ''), 'Balance set from ' || v_current || ' to ' || p_target),
    null, auth.uid()
  );
end;
$$;

grant execute on function public.set_session_balance(uuid, uuid, int, text) to authenticated;
