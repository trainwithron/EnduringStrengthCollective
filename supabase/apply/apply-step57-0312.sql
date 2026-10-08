-- STEP 57: 0312 A client booking or moving their own session must stay inside the coach's open hours and clear of time off: book_session and reschedule_booking now refuse any other time (a coach booking for a client is never refused)
--
-- Run apply-precheck first (every row ok = true). Then paste THIS file and run it once.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."
-- AFTERWARDS: Nothing changes for normal use: the booking screens already only offer times inside the coach's hours. A direct call that tries to book or move a client's own session outside the coach's open hours, or onto time off, is now refused with 'that time is outside your coach's hours'. A coach scheduling a client is never refused.
-- ON ERROR: it is all or nothing, so nothing was applied. Run   rollback;   once, copy the red error text, and send it back. Do not run the file again.
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

do $guard$
begin
  if not ((coalesce((select position('coach_time_is_open' in pg_get_functiondef(p.oid)) = 0 from pg_proc p where p.proname = 'book_session' and p.pronamespace = 'public'::regnamespace limit 1), false))) then
    raise exception 'Step 57 (0312) looks already applied, or the database is not in the state it expects. Nothing was changed. Run the precheck file and send Spot the result.';
  end if;
end
$guard$;

-- ====================================================================================================
-- migration 0312_booking_hours_server_check.sql
-- ====================================================================================================

-- Release S, part 1: a client booking or moving their own session must stay inside the coach's open hours (Ron: needed before outside coaches arrive, mid-November).
--
-- Until now book_session and reschedule_booking checked the notice period, credits and overlap (with the coach's buffer) but NOT the coach's weekly hours or time off: only the
-- request functions did, through coach_time_is_open (0279). The client screens never offer an off-hours time, but a direct call to the database could still book one. Now:
--   * book_session: a client booking for themselves is refused, "that time is outside your coach's hours", unless the whole session sits inside one open window and clear of time off.
--   * reschedule_booking: the same for the new time when a client moves their own session (a coach who is their own client is not refused; a coach moves a client's session another way).
--   * A coach booking a client's session (and a coach who is their own client) is never refused; the server's own routines are never refused. A weekly schedule
--     a client starts books each week through book_session, so a week outside the hours is reported as not booked, like any other refused week.
-- Both functions are the LIVE text (identical to 0291, checked by comparing the bodies) with only the check above added. Their rights are unchanged (signed-in users and the
-- server may run them; the public may not), and the migration stops if they ever are not. Needs 0279 (coach_time_is_open) and 0291. Re-runnable.

create or replace function public.book_session(p_coach_id uuid, p_athlete_id uuid, p_group_id uuid, p_start_at timestamp with time zone, p_end_at timestamp with time zone)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_is_self boolean;
  v_balance int;
  v_booking_id uuid;
  v_buffer_minutes int;
  v_minimum_notice_hours int;
begin
  if auth.role() = 'service_role' then
    null;
  elsif auth.uid() is null then
    raise exception 'not authorized to book this session';
  end if;

  v_is_self := coalesce(auth.uid() = p_athlete_id, false);

  if not v_is_self and not public.is_group_coach(p_group_id) and auth.role() is distinct from 'service_role' then
    raise exception 'not authorized to book this session';
  end if;

  if not public.is_training_client_of_group(p_group_id, p_athlete_id) then
    raise exception 'not a training client of this group';
  end if;

  if not exists (
    select 1 from public.group_memberships gm
    where gm.group_id = p_group_id and gm.profile_id = p_coach_id and gm.role = 'coach'
  ) then
    raise exception 'that coach does not coach this group';
  end if;

  if p_end_at <= p_start_at then
    raise exception 'invalid time range';
  end if;

  -- The coach's booking mode decides whether a client may book directly (see assert_client_may_book_directly).
  perform public.assert_client_may_book_directly(p_coach_id, p_athlete_id, p_group_id);

  select coalesce(bp.buffer_minutes, 0), coalesce(bp.minimum_notice_hours, 0)
    into v_buffer_minutes, v_minimum_notice_hours
  from public.coach_booking_policies bp where bp.coach_id = p_coach_id;
  v_buffer_minutes := coalesce(v_buffer_minutes, 0);
  v_minimum_notice_hours := coalesce(v_minimum_notice_hours, 0);

  if v_is_self and (p_start_at - now()) < make_interval(hours => v_minimum_notice_hours) then
    raise exception 'that session needs more advance notice';
  end if;

  -- A client booking for themselves must book inside the coach's open hours and clear of time off. The screens only offer such times; this makes the server refuse any other, so a
  -- direct call cannot book outside them. A coach booking for a client, a coach who is their own client, and the server's own routines are never refused: for them an
  -- off-hours time is a warning on the screen, not a block.
  if v_is_self and not coalesce(public.is_group_coach(p_group_id), false) and not public.coach_time_is_open(p_coach_id, p_start_at, p_end_at) then
    raise exception 'that time is outside your coach''s hours';
  end if;

  -- Only a client booking for themselves needs a credit. A coach can always schedule.
  if v_is_self then
    select balance into v_balance from public.session_credits
      where athlete_id = p_athlete_id and group_id = p_group_id
      for update;
    if coalesce(v_balance, 0) <= 0 then
      raise exception 'no session credits remaining';
    end if;
  end if;

  if exists (
    select 1 from public.bookings b
    where b.coach_id = p_coach_id
      and b.status = 'confirmed'
      and b.start_at < (p_end_at + make_interval(mins => v_buffer_minutes))
      and b.end_at > (p_start_at - make_interval(mins => v_buffer_minutes))
  ) or exists (
    select 1 from public.discovery_bookings d
    where d.coach_id = p_coach_id
      and d.status = 'confirmed'
      and d.start_at < (p_end_at + make_interval(mins => v_buffer_minutes))
      and d.end_at > (p_start_at - make_interval(mins => v_buffer_minutes))
  ) then
    raise exception 'that slot was just taken';
  end if;

  insert into public.bookings (coach_id, athlete_id, group_id, start_at, end_at, status, credit_state)
  values (p_coach_id, p_athlete_id, p_group_id, p_start_at, p_end_at, 'confirmed',
          case when v_is_self then 'prepaid' else 'unsettled' end)
  returning id into v_booking_id;

  if v_is_self then
    perform public.apply_session_credit_change(p_athlete_id, p_group_id, -1, 'booked', 'Booked a session', v_booking_id, auth.uid());
  end if;

  update public.booking_waitlist_entries
    set status = case when athlete_id = p_athlete_id then 'claimed' else 'expired' end
    where coach_id = p_coach_id
      and slot_start_at = p_start_at
      and slot_end_at = p_end_at
      and status in ('waiting', 'offered');

  return v_booking_id;
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
  v_attended_at timestamptz;
  v_window_hours int;
  v_buffer_minutes int;
  v_minimum_notice_hours int;
  v_athlete_name text;
  v_credit_state text;
begin
  if auth.role() = 'service_role' then
    null;
  elsif auth.uid() is null then
    raise exception 'Not authorized to reschedule this booking';
  end if;

  select athlete_id, group_id, coach_id, status, start_at, end_at, credit_state, attended_at
    into v_athlete_id, v_group_id, v_coach_id, v_status, v_start_at, v_end_at, v_credit_state, v_attended_at
  from public.bookings where id = p_booking_id
  for update;

  if v_athlete_id is null then
    raise exception 'booking not found';
  end if;
  if auth.uid() <> v_athlete_id then
    raise exception 'not authorized to reschedule this booking';
  end if;
  -- A client moves a session directly only when the coach's booking mode is 'free'. In 'request' mode they ask (request_booking_move);
  -- in 'coach_schedules' mode they message the coach. A coach who is their own client is never refused.
  if not coalesce(public.is_group_coach(v_group_id), false) then
    if public.coach_booking_mode(v_coach_id) = 'request' then
      raise exception 'your coach confirms moves: ask for the new time instead';
    elsif public.coach_booking_mode(v_coach_id) <> 'free' then
      raise exception 'your coach schedules your sessions';
    end if;
  end if;
  if v_status <> 'confirmed' then
    raise exception 'booking is not in a reschedulable state';
  end if;
  if not coalesce(public.is_group_coach(v_group_id), false) and (v_attended_at is not null or v_start_at <= now()) then
    raise exception 'this session has already started; ask your coach';
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

  -- The new time must also be inside the coach's open hours and clear of time off, for a client moving their own session (only the client can run this function; a coach who is their own client is not refused).
  if not coalesce(public.is_group_coach(v_group_id), false) and not public.coach_time_is_open(v_coach_id, p_new_start_at, p_new_end_at) then
    raise exception 'that time is outside your coach''s hours';
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

  if (v_start_at - now()) < make_interval(hours => v_window_hours) and v_credit_state in ('prepaid', 'settled', 'unsettled') then
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

-- The rights must be exactly what they were: signed-in users and the server, not the public or signed-out visitors.
do $acl$
begin
  if not has_function_privilege('authenticated', 'public.book_session(uuid, uuid, uuid, timestamptz, timestamptz)', 'execute')
     or not has_function_privilege('service_role', 'public.book_session(uuid, uuid, uuid, timestamptz, timestamptz)', 'execute')
     or has_function_privilege('anon', 'public.book_session(uuid, uuid, uuid, timestamptz, timestamptz)', 'execute')
     or not has_function_privilege('authenticated', 'public.reschedule_booking(uuid, timestamptz, timestamptz)', 'execute')
     or not has_function_privilege('service_role', 'public.reschedule_booking(uuid, timestamptz, timestamptz)', 'execute')
     or has_function_privilege('anon', 'public.reschedule_booking(uuid, timestamptz, timestamptz)', 'execute') then
    raise exception 'The rights on book_session or reschedule_booking are not what they were. NOTHING was changed by this migration.';
  end if;
end
$acl$;

commit;
