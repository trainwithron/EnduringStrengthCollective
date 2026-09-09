-- Bookings had no real server-side gate: book-slot-button.tsx (self-book),
-- assign-slot-button.tsx, and expanded-day-scheduler.tsx (coach-assigned)
-- each did a plain insert into bookings, then a *separate* call to
-- adjust_session_credits — meaning the booking itself always succeeded
-- regardless of balance, and adjust_session_credits' own greatest(0, ...)
-- clamp silently absorbed the "you didn't actually have a credit" case
-- instead of rejecting it. The only real DB-level guard was the partial
-- unique index on (coach_id, start_at), which only catches two bookings
-- starting at the exact same instant — not a general overlap.
--
-- This makes booking one atomic, security-definer operation: check
-- authorization, check (for a self-booking athlete) that a credit
-- actually exists, check for any overlapping confirmed booking for that
-- coach (not just an exact start_at collision), insert, then spend the
-- credit — all in one transaction, so nothing between the check and the
-- write can race.
--
-- Deliberately NOT validating that the slot falls inside a declared
-- coach_availability_windows row here: that would mean comparing wall-clock
-- times, and this database's session timezone is UTC while every existing
-- slot-generation call (lib/booking-slots.ts) works in the browser's local
-- time — enforcing that server-side today would reject real slots for any
-- coach not in UTC. That's the pre-existing "no timezone handling in
-- booking/scheduling" gap, tracked separately; bolting a UTC-only check
-- onto this fix would make bookings worse, not safer, for anyone not in
-- UTC. The overlap and credit checks below don't depend on timezone at
-- all (they compare timestamptz instants directly, or a plain integer).
create or replace function public.book_session(
  p_coach_id uuid,
  p_athlete_id uuid,
  p_group_id uuid,
  p_start_at timestamptz,
  p_end_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_self boolean;
  v_balance int;
  v_booking_id uuid;
begin
  v_is_self := auth.uid() = p_athlete_id;

  if not v_is_self and not public.is_group_coach(p_group_id) then
    raise exception 'not authorized to book this session';
  end if;

  if not public.is_client_of_coach(p_coach_id) then
    raise exception 'not a client of this coach';
  end if;

  if p_end_at <= p_start_at then
    raise exception 'invalid time range';
  end if;

  -- A self-booking athlete must actually have a credit. A coach assigning
  -- a session on a client's behalf can override this (e.g. a courtesy
  -- session) — same trust already granted to coaches by
  -- adjust_session_credits itself.
  if v_is_self then
    select balance into v_balance from public.session_credits
      where athlete_id = p_athlete_id and group_id = p_group_id;
    if coalesce(v_balance, 0) <= 0 then
      raise exception 'no session credits remaining';
    end if;
  end if;

  -- General overlap guard: two different clients booking overlapping —
  -- not necessarily identical — times with the same coach.
  if exists (
    select 1 from public.bookings b
    where b.coach_id = p_coach_id
      and b.status = 'confirmed'
      and b.start_at < p_end_at
      and b.end_at > p_start_at
  ) then
    raise exception 'that slot was just taken';
  end if;

  insert into public.bookings (coach_id, athlete_id, group_id, start_at, end_at, status)
  values (p_coach_id, p_athlete_id, p_group_id, p_start_at, p_end_at, 'confirmed')
  returning id into v_booking_id;

  perform public.adjust_session_credits(p_athlete_id, p_group_id, -1);

  return v_booking_id;
end;
$$;

grant execute on function public.book_session(uuid, uuid, uuid, timestamptz, timestamptz) to authenticated;
