-- UNDO for step 19 (0277). Only if cancelling or moving a booking breaks after step 19. Puts the two booking functions back to the previous version (late changes take a session by themselves again), removes the Charge/Waive function and the notices. The flag columns stay (harmless).
-- WHAT YOU SHOULD SEE: "Success. No rows returned."   Then tell Spot, and do not run the step again until Spot says why it failed.
begin;
create or replace function public.cancel_booking_and_refund_credit(p_booking_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_athlete_id uuid;
  v_group_id uuid;
  v_coach_id uuid;
  v_status text;
  v_state text;
  v_start_at timestamptz;
  v_end_at timestamptz;
  v_window_hours int;
  v_is_athlete_cancelling boolean;
  v_should_refund boolean;
begin
  if auth.role() = 'service_role' then
    null;
  elsif auth.uid() is null then
    raise exception 'not authorized to cancel this booking';
  end if;

  select athlete_id, group_id, coach_id, status, credit_state, start_at, end_at
    into v_athlete_id, v_group_id, v_coach_id, v_status, v_state, v_start_at, v_end_at
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

  if v_is_athlete_cancelling then
    select coalesce(
      (select cancellation_window_hours from public.coach_booking_policies where coach_id = v_coach_id),
      24
    ) into v_window_hours;
    v_should_refund := (v_start_at - now()) >= make_interval(hours => v_window_hours);
  else
    v_should_refund := true;
  end if;

  update public.bookings set status = 'cancelled' where id = p_booking_id;

  if v_state in ('prepaid', 'settled') then
    -- A credit was taken for this booking: it comes back unless the client cancelled inside the window.
    if v_should_refund then
      perform public.apply_session_credit_change(v_athlete_id, v_group_id, 1, 'refund', 'Booking cancelled', p_booking_id, auth.uid());
    end if;
  elsif v_state = 'unsettled' and v_is_athlete_cancelling and not v_should_refund then
    -- Nothing was taken at booking, so a late cancellation by the client is where the session is charged.
    update public.bookings set late_cancel = true where id = p_booking_id;
    perform public.apply_session_credit_change(v_athlete_id, v_group_id, -1, 'adjusted', 'Late cancellation', p_booking_id, auth.uid());
  end if;

  perform public.offer_freed_slot_to_waitlist(v_coach_id, v_start_at, v_end_at);
end;
$function$;

create or replace function public.reschedule_booking(p_booking_id uuid, p_new_start_at timestamp with time zone, p_new_end_at timestamp with time zone)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_athlete_id uuid;
  v_group_id uuid;
  v_coach_id uuid;
  v_status text;
  v_start_at timestamptz;
  v_end_at timestamptz;
  v_window_hours int;
  v_buffer_minutes int;
  v_minimum_notice_hours int;
begin
  if auth.role() = 'service_role' then
    null;
  elsif auth.uid() is null then
    raise exception 'Not authorized to reschedule this booking';
  end if;

  select athlete_id, group_id, coach_id, status, start_at, end_at
    into v_athlete_id, v_group_id, v_coach_id, v_status, v_start_at, v_end_at
  from public.bookings where id = p_booking_id
  for update;

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

  select coalesce(bp.buffer_minutes, 0), coalesce(bp.minimum_notice_hours, 0)
    into v_buffer_minutes, v_minimum_notice_hours
  from public.coach_booking_policies bp where bp.coach_id = v_coach_id;
  v_buffer_minutes := coalesce(v_buffer_minutes, 0);
  v_minimum_notice_hours := coalesce(v_minimum_notice_hours, 0);

  if (p_new_start_at - now()) < make_interval(hours => v_minimum_notice_hours) then
    raise exception 'that session needs more advance notice';
  end if;

  if exists (
    select 1 from public.bookings b
    where b.coach_id = v_coach_id
      and b.id <> p_booking_id
      and b.status = 'confirmed'
      and b.start_at < (p_new_end_at + make_interval(mins => v_buffer_minutes))
      and b.end_at > (p_new_start_at - make_interval(mins => v_buffer_minutes))
  ) or exists (
    select 1 from public.discovery_bookings d
    where d.coach_id = v_coach_id
      and d.status = 'confirmed'
      and d.start_at < (p_new_end_at + make_interval(mins => v_buffer_minutes))
      and d.end_at > (p_new_start_at - make_interval(mins => v_buffer_minutes))
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
    perform public.apply_session_credit_change(v_athlete_id, v_group_id, -1, 'adjusted', 'Late reschedule', p_booking_id, auth.uid());
  end if;

  perform public.offer_freed_slot_to_waitlist(v_coach_id, v_start_at, v_end_at);
end;
$function$;

drop function if exists public.resolve_late_change(uuid, boolean);
delete from public.notifications where type = 'late_change';
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in (
    'comment', 'program_assigned', 'macros_assigned', 'partner_request',
    'partner_request_accepted', 'milestone_celebration', 'gym_visitor_lead',
    'trainer_dispatch_offer', 'trainer_dispatch_question', 'session_pattern_note',
    'credits_expired', 'waitlist_slot_offered', 'recurring_booking_conflict',
    'email_changed', 'direct_message'
  ));
commit;
