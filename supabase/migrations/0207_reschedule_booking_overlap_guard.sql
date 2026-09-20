-- Real gap confirmed by direct code review (ia_gap_assessment_and_qa_findings.md,
-- Q2): reschedule_booking (0068, last touched by 0189) blindly updates
-- start_at/end_at with zero validation — no invalid-time-range check, no
-- overlap check against this coach's other confirmed bookings or
-- discovery_bookings. book_session (0125) already does both of these
-- for a brand-new booking; a reschedule is just as capable of creating
-- a double-booking and was never held to the same standard. The
-- client's own error copy ("That slot was just taken. Try another.",
-- reschedule-slot-button.tsx) already implies this check exists — it
-- didn't, until now.
--
-- Reproduced byte-for-byte from 0189's own definition except for the
-- two new guards below, ported directly from book_session's own
-- checks (same predicate shape, same overlap window logic) rather than
-- inventing new behavior.
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

  if p_new_end_at <= p_new_start_at then
    raise exception 'invalid time range';
  end if;

  -- Same overlap guard as book_session, scoped to this coach's other
  -- confirmed bookings/discovery calls, explicitly excluding this
  -- booking's own current row (it always "overlaps" its own existing
  -- slot, which isn't a real conflict).
  if exists (
    select 1 from public.bookings b
    where b.coach_id = v_coach_id
      and b.id <> p_booking_id
      and b.status = 'confirmed'
      and b.start_at < p_new_end_at
      and b.end_at > p_new_start_at
  ) or exists (
    select 1 from public.discovery_bookings d
    where d.coach_id = v_coach_id
      and d.status = 'confirmed'
      and d.start_at < p_new_end_at
      and d.end_at > p_new_start_at
  ) then
    raise exception 'that slot was just taken';
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
