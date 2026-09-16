-- scheduling_calendar_spotter_idea.md — the real attendance data this
-- Spotter needs did not previously exist. `bookings.status` is only
-- 'confirmed'/'cancelled' (0023_booking.sql); there was no way to know
-- whether a past confirmed booking was actually attended, and
-- cancel_booking_and_refund_credit (0068) only used its on-time-vs-late
-- distinction transiently (to decide a credit refund) without ever
-- persisting it on the row. Both gaps get closed here, additively.
--
-- `no_show` defaults false and is the ONLY state a coach ever has to set
-- manually — a past confirmed booking is presumed attended unless
-- flagged otherwise (coach_ease_of_use_design_principle.md's "Excel
-- shortcuts" test: don't make a coach click through every session that
-- went fine, only the exceptional ones that didn't).
alter table public.bookings
  add column no_show boolean not null default false,
  add column late_cancel boolean not null default false;

-- Coach-only: whether a client actually showed up is the coach's call to
-- make, not a self-report — no athlete-facing equivalent, unlike most
-- other toggles in this app. Idempotent (p_no_show can be set back to
-- false to undo a mis-click).
create or replace function public.set_booking_no_show(p_booking_id uuid, p_no_show boolean)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_group_id uuid;
  v_status text;
  v_start_at timestamptz;
begin
  select group_id, status, start_at into v_group_id, v_status, v_start_at
  from public.bookings where id = p_booking_id;

  if v_group_id is null then
    raise exception 'booking not found';
  end if;
  if not public.is_group_coach(v_group_id) then
    raise exception 'not authorized to mark attendance for this booking';
  end if;
  if v_status <> 'confirmed' then
    raise exception 'only a confirmed booking can be marked';
  end if;
  if v_start_at > now() then
    raise exception 'cannot mark attendance for a future booking';
  end if;

  update public.bookings set no_show = p_no_show where id = p_booking_id;
end;
$$;

-- Persists exactly the same on-time-vs-late judgment this function
-- already computed transiently as v_should_refund, so it can be read
-- back later instead of only acted on once. A coach-initiated
-- cancellation is never the client's fault (existing comment/logic,
-- unchanged) and so never counts as a late_cancel either.
create or replace function public.cancel_booking_and_refund_credit(p_booking_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_athlete_id uuid;
  v_group_id uuid;
  v_coach_id uuid;
  v_status text;
  v_start_at timestamptz;
  v_window_hours int;
  v_is_athlete_cancelling boolean;
  v_should_refund boolean;
begin
  select athlete_id, group_id, coach_id, status, start_at
    into v_athlete_id, v_group_id, v_coach_id, v_status, v_start_at
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

  v_is_athlete_cancelling := auth.uid() = v_athlete_id;

  if v_is_athlete_cancelling then
    select coalesce(
      (select cancellation_window_hours from public.coach_booking_policies where coach_id = v_coach_id),
      24
    ) into v_window_hours;
    v_should_refund := (v_start_at - now()) >= make_interval(hours => v_window_hours);
  else
    -- A coach-initiated cancellation is never the client's fault.
    v_should_refund := true;
  end if;

  update public.bookings
    set status = 'cancelled', late_cancel = (v_is_athlete_cancelling and not v_should_refund)
    where id = p_booking_id;

  if v_should_refund then
    insert into public.session_credits (athlete_id, group_id, balance)
    values (v_athlete_id, v_group_id, 1)
    on conflict (athlete_id, group_id)
    do update set balance = public.session_credits.balance + 1, updated_at = now();
  end if;
end;
$$;
