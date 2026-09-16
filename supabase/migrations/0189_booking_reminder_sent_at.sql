-- acuity_replacement_gap_audit_sept16.md — the single clearest,
-- highest-value gap against Acuity: zero reminder/confirmation infra
-- exists around bookings. This is the reminder half's own dedup
-- tracking — without it, a cron running every few minutes would
-- re-send the same reminder on every tick until the session starts.
-- Nullable, set once the reminder actually goes out.
alter table public.bookings
  add column reminder_sent_at timestamptz;

-- Real, load-bearing addition to the EXISTING reschedule_booking
-- (0068_booking_cancellation_policy.sql), reproduced here byte-for-byte
-- except for the one new line below — a booking moved to a new
-- start_at must have its reminder flag reset to null, otherwise a
-- session rescheduled after its original reminder already fired would
-- never get reminded again for its real, new time.
create or replace function public.reschedule_booking(
  p_booking_id uuid,
  p_new_start_at timestamptz,
  p_new_end_at timestamptz
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_athlete_id uuid;
  v_group_id uuid;
  v_coach_id uuid;
  v_status text;
  v_start_at timestamptz;
  v_window_hours int;
begin
  select athlete_id, group_id, coach_id, status, start_at
    into v_athlete_id, v_group_id, v_coach_id, v_status, v_start_at
  from public.bookings where id = p_booking_id;

  if v_athlete_id is null then
    raise exception 'booking not found';
  end if;
  if auth.uid() <> v_athlete_id then
    raise exception 'not authorized to reschedule this booking';
  end if;
  if v_status <> 'confirmed' then
    raise exception 'booking is not in a reschedulable state';
  end if;

  select coalesce(
    (select cancellation_window_hours from public.coach_booking_policies where coach_id = v_coach_id),
    24
  ) into v_window_hours;

  update public.bookings
    set start_at = p_new_start_at, end_at = p_new_end_at, reminder_sent_at = null
    where id = p_booking_id;

  if (v_start_at - now()) < make_interval(hours => v_window_hours) then
    perform public.adjust_session_credits(v_athlete_id, v_group_id, -1);
  end if;
end;
$$;
