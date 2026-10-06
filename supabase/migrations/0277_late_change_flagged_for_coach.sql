-- Ron's rule (Oct 6): a client who cancels or moves a session INSIDE the coach's cancellation window is FLAGGED to the coach, who taps Charge or
-- Waive. Nothing is taken automatically. Until now the database took the session by itself (a late cancel kept a prepaid credit or charged an
-- unsettled one; a late move took one more), and the client was told so.
--
-- What changes:
--  * bookings.late_change_kind ('cancel' or 'reschedule') and bookings.late_charge_state ('flagged', 'charged', 'waived'). late_cancel stays as it was.
--  * cancel_booking_and_refund_credit: a late client cancel gives back any credit already taken, marks the booking flagged, and tells the coach in the
--    notification list. A cancel in time, or by the coach, behaves exactly as before.
--  * reschedule_booking: a late move no longer takes a session; it marks the booking flagged and tells the coach.
--  * resolve_late_change(booking, charge): the coach's decision. Charge takes one session (through the internal credit function, like every
--    other charge); Waive clears the flag. Only the coach of that booking's group, and only once per flag.
--  * the notification type list gains 'late_change'.
-- Both replaced functions are the 0248 text as live, with only the late branch changed (the paste step checks the live text first).
-- Needs 0248 (credit settlement) and 0276 (the notification type list). Idempotent where it can be: re-running replaces the functions again.

alter table public.bookings
  add column if not exists late_change_kind text check (late_change_kind in ('cancel', 'reschedule')),
  add column if not exists late_charge_state text check (late_charge_state in ('flagged', 'charged', 'waived'));

create index if not exists bookings_late_flagged_idx on public.bookings (coach_id) where late_charge_state = 'flagged';

alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in (
    'comment', 'program_assigned', 'macros_assigned', 'partner_request',
    'partner_request_accepted', 'milestone_celebration', 'gym_visitor_lead',
    'trainer_dispatch_offer', 'trainer_dispatch_question', 'session_pattern_note',
    'credits_expired', 'waitlist_slot_offered', 'recurring_booking_conflict',
    'email_changed', 'direct_message', 'late_change'
  ));

-- ---- cancelling ----
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
  v_late boolean := false;
  v_athlete_name text;
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

  -- A session the coach already waived (credit_state 'waived') is never flagged: they chose not to charge it.
  v_late := v_is_athlete_cancelling and not v_should_refund and v_state in ('prepaid', 'settled', 'unsettled');

  update public.bookings set status = 'cancelled' where id = p_booking_id;

  if v_late then
    -- A client cancelling inside the window is FLAGGED for the coach, who decides whether it counts (Charge or Waive). Nothing is taken
    -- automatically: a credit already taken at booking is given back, and the coach can take it again with Charge.
    update public.bookings
      set late_cancel = true, late_change_kind = 'cancel', late_charge_state = 'flagged'
      where id = p_booking_id;
    if v_state in ('prepaid', 'settled') then
      perform public.apply_session_credit_change(v_athlete_id, v_group_id, 1, 'refund', 'Booking cancelled inside the window; your coach decides if it counts', p_booking_id, auth.uid());
    end if;
    select full_name into v_athlete_name from public.profiles where id = v_athlete_id;
    insert into public.notifications (profile_id, group_id, type, body, link_path)
    values (v_coach_id, v_group_id, 'late_change',
      coalesce(nullif(btrim(v_athlete_name), ''), 'A client') || ' cancelled a session inside the ' || v_window_hours::text || '-hour window. Charge it or waive it.',
      '/dashboard');
  elsif v_state in ('prepaid', 'settled') then
    -- A credit was taken for this booking and the cancellation is in time (or made by the coach): it comes back.
    if v_should_refund then
      perform public.apply_session_credit_change(v_athlete_id, v_group_id, 1, 'refund', 'Booking cancelled', p_booking_id, auth.uid());
    end if;
  end if;

  perform public.offer_freed_slot_to_waitlist(v_coach_id, v_start_at, v_end_at);
end;
$function$;

-- ---- rescheduling ----
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
  v_athlete_name text;
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
    -- A late move is FLAGGED for the coach, who decides whether it counts (Charge or Waive). No session is taken automatically.
    update public.bookings
      set late_change_kind = 'reschedule', late_charge_state = 'flagged'
      where id = p_booking_id;
    select full_name into v_athlete_name from public.profiles where id = v_athlete_id;
    insert into public.notifications (profile_id, group_id, type, body, link_path)
    values (v_coach_id, v_group_id, 'late_change',
      coalesce(nullif(btrim(v_athlete_name), ''), 'A client') || ' moved a session inside the ' || v_window_hours::text || '-hour window. Charge it or waive it.',
      '/dashboard');
  end if;

  perform public.offer_freed_slot_to_waitlist(v_coach_id, v_start_at, v_end_at);
end;
$function$;

-- The coach's decision on a flagged late change.
create or replace function public.resolve_late_change(p_booking_id uuid, p_charge boolean)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_athlete_id uuid;
  v_group_id uuid;
  v_coach_id uuid;
  v_state text;
  v_kind text;
begin
  if auth.uid() is null and auth.role() is distinct from 'service_role' then
    raise exception 'not authorized';
  end if;

  select athlete_id, group_id, coach_id, late_charge_state, late_change_kind
    into v_athlete_id, v_group_id, v_coach_id, v_state, v_kind
  from public.bookings where id = p_booking_id
  for update;

  if v_athlete_id is null then
    raise exception 'booking not found';
  end if;
  -- The booking's own coach decides (or an owner or admin of the organization), not just any coach of the group.
  if auth.role() is distinct from 'service_role'
     and not ((v_coach_id = auth.uid() and public.is_group_coach(v_group_id)) or public.is_org_admin_of_group(v_group_id)) then
    raise exception 'not authorized';
  end if;
  if v_state is distinct from 'flagged' then
    raise exception 'this change is not waiting for a decision';
  end if;

  if p_charge then
    perform public.apply_session_credit_change(
      v_athlete_id, v_group_id, -1, 'adjusted',
      case when v_kind = 'reschedule' then 'Late reschedule, charged by your coach' else 'Late cancellation, charged by your coach' end,
      p_booking_id, auth.uid()
    );
    update public.bookings set late_charge_state = 'charged' where id = p_booking_id;
  else
    update public.bookings set late_charge_state = 'waived' where id = p_booking_id;
  end if;
end;
$function$;

revoke all on function public.resolve_late_change(uuid, boolean) from public, anon;
grant execute on function public.resolve_late_change(uuid, boolean) to authenticated, service_role;

-- A coach's Charge or Waive changes this column, so it is watched in the audit log like credit_state (0267).
drop trigger if exists bookings_audit on public.bookings;
create trigger bookings_audit after insert or update on public.bookings
  for each row execute function public.audit_watch('credit_state,late_charge_state', 'update_only', 'id');
