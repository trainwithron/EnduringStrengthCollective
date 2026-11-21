CREATE OR REPLACE FUNCTION public.cancel_booking_and_refund_credit(p_booking_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_athlete_id uuid;
  v_group_id uuid;
  v_coach_id uuid;
  v_status text;
  v_state text;
  v_start_at timestamptz;
  v_end_at timestamptz;
  v_attended_at timestamptz;
  v_window_hours int;
  v_is_athlete_cancelling boolean;
  v_should_refund boolean;
  v_late boolean := false;
  v_athlete_name text;
begin
  if auth.role() = 'service_role' then
    null;
  elsif auth.uid() is null then
    raise exception 'not authorized to cancel this booking';
  end if;

  select athlete_id, group_id, coach_id, status, credit_state, start_at, end_at, attended_at
    into v_athlete_id, v_group_id, v_coach_id, v_status, v_state, v_start_at, v_end_at, v_attended_at
  from public.bookings where id = p_booking_id
  for update;

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

  -- A client cannot cancel a session that has started or was already marked attended (that would hand back a credit for a session that happened).
  if v_is_athlete_cancelling and not coalesce(public.is_group_coach(v_group_id), false)
     and (v_attended_at is not null or v_start_at <= now()) then
    raise exception 'this session has already started; ask your coach';
  end if;

  -- FIX 3 (0428): a late move the coach charged is this visit's one session. The client cancelling it afterwards (even after moving it again) gets nothing back and it is
  -- not flagged again. (A coach cancelling it gives the session back below, as any coach cancellation does.)
  if v_is_athlete_cancelling and not coalesce(public.is_group_coach(v_group_id), false)
     and public.booking_late_move_charged(p_booking_id) then
    -- A later late move still waiting for the coach is settled by this one: the earlier charge stands.
    update public.bookings set status = 'cancelled', late_charge_state = case when late_charge_state = 'flagged' then 'charged' else late_charge_state end where id = p_booking_id;
    perform public.offer_freed_slot_to_waitlist(v_coach_id, v_start_at, v_end_at);
    return;
  end if;

  if v_is_athlete_cancelling then
    select coalesce(
      (select cancellation_window_hours from public.coach_booking_policies where coach_id = v_coach_id),
      24
    ) into v_window_hours;
    v_should_refund := (v_start_at - now()) >= make_interval(hours => v_window_hours);
  else
    v_should_refund := true;
  end if;

  -- A session the coach already waived (credit_state 'waived') is never flagged: they chose not to charge it.
  v_late := v_is_athlete_cancelling and not v_should_refund and v_state in ('prepaid', 'settled', 'unsettled');

  update public.bookings set status = 'cancelled' where id = p_booking_id;
  -- FIX 3 (0428): the coach cancelling gives the session back, so a late move still waiting for Charge or Waive has nothing left to decide.
  if not v_is_athlete_cancelling then
    update public.bookings set late_charge_state = 'waived' where id = p_booking_id and late_charge_state = 'flagged';
  end if;

  if v_late then
    -- A client cancelling inside the window is FLAGGED for the coach, who decides whether it counts (Charge or Waive). Nothing is taken
    -- automatically: a credit already taken at booking is given back, and the coach can take it again with Charge.
    update public.bookings
      set late_cancel = true, late_change_kind = 'cancel', late_charge_state = 'flagged'
      where id = p_booking_id;
    if v_state in ('prepaid', 'settled') and least(1, public.booking_taken(p_booking_id)) > 0 then
      perform public.apply_session_credit_change(v_athlete_id, v_group_id, least(1, public.booking_taken(p_booking_id)), 'refund', 'Booking cancelled inside the window; your coach decides if it counts', p_booking_id, auth.uid());
    end if;
    select full_name into v_athlete_name from public.profiles where id = v_athlete_id;
    insert into public.notifications (profile_id, group_id, type, body, link_path)
    values (v_coach_id, v_group_id, 'late_change',
      coalesce(nullif(btrim(v_athlete_name), ''), 'A client') || ' cancelled a session inside the ' || v_window_hours::text || '-hour window. Charge it or waive it.',
      '/dashboard');
  elsif v_state in ('prepaid', 'settled') then
    -- A credit was taken for this booking and the cancellation is in time (or made by the coach): it comes back. FIX 3 (0428): only what it actually took (a 'prepaid'
    -- booking that never took a session gives nothing back).
    if v_should_refund and least(1, public.booking_taken(p_booking_id)) > 0 then
      perform public.apply_session_credit_change(v_athlete_id, v_group_id, least(1, public.booking_taken(p_booking_id)), 'refund', 'Booking cancelled', p_booking_id, auth.uid());
    end if;
  end if;

  perform public.offer_freed_slot_to_waitlist(v_coach_id, v_start_at, v_end_at);
end;
$function$
