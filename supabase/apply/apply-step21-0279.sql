-- STEP 21: 0279 with self-booking off a client asks to move a session and the coach confirms (the session stays put until then)
--
-- Run apply-precheck first (every row ok = true). Then paste THIS file and run it once.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."
-- AFTERWARDS: With self-booking switched off, a client who wants a different time picks it and sends a request; the session stays where it is. You get a notice and a Confirm / Decline row under Needs your decision. Confirm moves it (and flags it for Charge or Waive if it was inside your window); Decline leaves it. The client is told either way. With self-booking on, clients move directly as before. Test with a throwaway client.
-- ON ERROR: it is all or nothing, so nothing was applied. Run   rollback;   once, copy the red error text, and send it back. Do not run the file again.
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

do $guard$
begin
  if not ((coalesce((select md5(replace(pg_get_functiondef(p.oid), chr(13), '')) = '1df6fdc5b7ed651158e1d39b99312519' from pg_proc p where p.oid = to_regprocedure('public.reschedule_booking(uuid, timestamptz, timestamptz)')), false) and to_regclass('public.booking_move_requests') is null)) then
    raise exception 'Step 21 (0279) looks already applied, or the database is not in the state it expects. Nothing was changed. Run the precheck file and send Spot the result.';
  end if;
end
$guard$;

-- ====================================================================================================
-- migration 0279_client_move_requests.sql
-- ====================================================================================================

-- Ron's rule (Oct 6): when self-booking is OFF a client may still ask to move a session, but the session stays where it is until the coach
-- confirms. With self-booking ON clients move directly, as before.
--
--  * booking_move_requests: one row per ask (booking, new time, pending / confirmed / declined / cancelled). Only one pending request per booking.
--    Read by the client and the coach; written only through the two functions below.
--  * request_booking_move(booking, new_start, new_end): the client asks. Checks the same things a direct move checks (the booking is theirs and
--    confirmed, minimum notice, the slot is free with the buffer, and the new time falls inside one of the coach's weekly hours), creates the
--    request and tells the coach (notice type move_request).
--  * resolve_move_request(request, confirm): the booking's coach (or an org owner or admin) decides. Confirm re-checks the slot, moves the booking
--    (and applies the late-change flag if the original time is inside the cancellation window, exactly as 0277 does for a direct move), offers the
--    freed slot to the waiting list, and tells the client. Decline leaves the session where it was and tells the client. It answers 'confirmed',
--    'declined' or 'closed' (the session was cancelled or has started, so the request just closes).
--  * reschedule_booking: a client can no longer move a session directly while the coach has self-booking off. It is the 0277 text with that
--    one check added (the paste step checks the live text first).
--  * the notification type list gains move_request and move_decision.
-- Needs 0277 (late-change flags and the notification type list) and 0278 (the self-booking switch). Re-running replaces the functions again.

alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in (
    'comment', 'program_assigned', 'macros_assigned', 'partner_request',
    'partner_request_accepted', 'milestone_celebration', 'gym_visitor_lead',
    'trainer_dispatch_offer', 'trainer_dispatch_question', 'session_pattern_note',
    'credits_expired', 'waitlist_slot_offered', 'recurring_booking_conflict',
    'email_changed', 'direct_message', 'late_change', 'move_request', 'move_decision'
  ));

create table if not exists public.booking_move_requests (
  id uuid primary key default uuid_generate_v4(),
  booking_id uuid not null references public.bookings(id) on delete cascade,
  athlete_id uuid not null references public.profiles(id) on delete cascade,
  coach_id uuid not null references public.profiles(id) on delete cascade,
  group_id uuid not null references public.groups(id) on delete cascade,
  from_start_at timestamptz not null,
  new_start_at timestamptz not null,
  new_end_at timestamptz not null check (new_end_at > new_start_at),
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'declined', 'cancelled')),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid references public.profiles(id) on delete set null
);
create unique index if not exists booking_move_requests_one_pending on public.booking_move_requests (booking_id) where status = 'pending';
create index if not exists booking_move_requests_coach_pending on public.booking_move_requests (coach_id) where status = 'pending';

alter table public.booking_move_requests enable row level security;
drop policy if exists "move_requests_select_participants" on public.booking_move_requests;
create policy "move_requests_select_participants" on public.booking_move_requests for select
  to authenticated using (athlete_id = (select auth.uid()) or coach_id = (select auth.uid()) or public.is_group_coach(group_id));
-- No insert, update or delete policy for signed-in users: requests are created and decided only by the two functions below.

create or replace function public.request_booking_move(p_booking_id uuid, p_new_start_at timestamp with time zone, p_new_end_at timestamp with time zone)
returns uuid
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
  v_buffer_minutes int;
  v_minimum_notice_hours int;
  v_tz text;
  v_local_start timestamp;
  v_local_end timestamp;
  v_name text;
  v_request_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not authorized to ask for this move';
  end if;

  select athlete_id, group_id, coach_id, status, start_at
    into v_athlete_id, v_group_id, v_coach_id, v_status, v_start_at
  from public.bookings where id = p_booking_id
  for update;

  if v_athlete_id is null then
    raise exception 'booking not found';
  end if;
  if auth.uid() <> v_athlete_id then
    raise exception 'not authorized to ask for this move';
  end if;
  if v_status <> 'confirmed' then
    raise exception 'booking is not in a movable state';
  end if;
  if p_new_end_at <= p_new_start_at then
    raise exception 'invalid time range';
  end if;
  if v_start_at <= now() then
    raise exception 'that session has already started';
  end if;

  select coalesce(bp.buffer_minutes, 0), coalesce(bp.minimum_notice_hours, 0)
    into v_buffer_minutes, v_minimum_notice_hours
  from public.coach_booking_policies bp where bp.coach_id = v_coach_id;
  v_buffer_minutes := coalesce(v_buffer_minutes, 0);
  v_minimum_notice_hours := coalesce(v_minimum_notice_hours, 0);

  if (p_new_start_at - now()) < make_interval(hours => v_minimum_notice_hours) then
    raise exception 'that session needs more advance notice';
  end if;

  select coalesce(pr.timezone, 'America/New_York') into v_tz from public.profiles pr where pr.id = v_coach_id;
  if v_tz is null or not exists (select 1 from pg_timezone_names where name = v_tz) then
    v_tz := 'America/New_York';
  end if;
  v_local_start := p_new_start_at at time zone v_tz;
  v_local_end := p_new_end_at at time zone v_tz;

  -- The new time must sit inside one of the coach's weekly hours.
  if not exists (
    select 1 from public.coach_availability_windows w
    where w.coach_id = v_coach_id
      and w.weekday = extract(dow from v_local_start)::int
      and w.start_time <= v_local_start::time
      and w.end_time >= v_local_end::time
      and v_local_start::date = v_local_end::date
  ) then
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

  begin
    insert into public.booking_move_requests (booking_id, athlete_id, coach_id, group_id, from_start_at, new_start_at, new_end_at)
    values (p_booking_id, v_athlete_id, v_coach_id, v_group_id, v_start_at, p_new_start_at, p_new_end_at)
    returning id into v_request_id;
  exception when unique_violation then
    raise exception 'you already asked to move this session; your coach has not answered yet';
  end;

  select full_name into v_name from public.profiles where id = v_athlete_id;
  insert into public.notifications (profile_id, group_id, type, body, link_path)
  values (v_coach_id, v_group_id, 'move_request',
    coalesce(nullif(btrim(v_name), ''), 'A client') || ' asked to move their ' ||
      to_char(v_start_at at time zone v_tz, 'Dy Mon FMDD, FMHH12:MI AM') || ' session to ' ||
      to_char(v_local_start, 'Dy Mon FMDD, FMHH12:MI AM') || '. Confirm or decline.',
    '/dashboard');

  return v_request_id;
end;
$function$;

create or replace function public.resolve_move_request(p_request_id uuid, p_confirm boolean)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  r public.booking_move_requests%rowtype;
  v_b public.bookings%rowtype;
  v_buffer_minutes int;
  v_window_hours int;
  v_tz text;
  v_name text;
begin
  if auth.uid() is null and auth.role() is distinct from 'service_role' then
    raise exception 'not authorized';
  end if;

  select * into r from public.booking_move_requests where id = p_request_id for update;
  if r.id is null then
    raise exception 'request not found';
  end if;
  if auth.role() is distinct from 'service_role'
     and not ((r.coach_id = auth.uid() and public.is_group_coach(r.group_id)) or public.is_org_admin_of_group(r.group_id)) then
    raise exception 'not authorized';
  end if;
  if r.status <> 'pending' then
    raise exception 'this request was already answered';
  end if;

  select coalesce(pr.timezone, 'America/New_York') into v_tz from public.profiles pr where pr.id = r.coach_id;
  if v_tz is null or not exists (select 1 from pg_timezone_names where name = v_tz) then
    v_tz := 'America/New_York';
  end if;

  select * into v_b from public.bookings where id = r.booking_id for update;

  -- The session was cancelled or has already started: the request just closes.
  if v_b.id is null or v_b.status <> 'confirmed' or v_b.start_at <= now() then
    update public.booking_move_requests set status = 'cancelled', decided_at = now(), decided_by = auth.uid() where id = r.id;
    return 'closed';
  end if;

  if not p_confirm then
    update public.booking_move_requests set status = 'declined', decided_at = now(), decided_by = auth.uid() where id = r.id;
    insert into public.notifications (profile_id, group_id, type, body, link_path)
    values (r.athlete_id, r.group_id, 'move_decision',
      'Your coach kept your session at ' || to_char(v_b.start_at at time zone v_tz, 'Dy Mon FMDD, FMHH12:MI AM') || '.',
      '/groups/' || r.group_id::text || '/calendar');
    return 'declined';
  end if;

  select coalesce(bp.buffer_minutes, 0), coalesce(bp.cancellation_window_hours, 24)
    into v_buffer_minutes, v_window_hours
  from public.coach_booking_policies bp where bp.coach_id = r.coach_id;
  v_buffer_minutes := coalesce(v_buffer_minutes, 0);
  v_window_hours := coalesce(v_window_hours, 24);

  if r.new_start_at <= now() then
    raise exception 'that new time has already passed';
  end if;

  if exists (
    select 1 from public.bookings b
    where b.coach_id = r.coach_id
      and b.id <> r.booking_id
      and b.status = 'confirmed'
      and b.start_at < (r.new_end_at + make_interval(mins => v_buffer_minutes))
      and b.end_at > (r.new_start_at - make_interval(mins => v_buffer_minutes))
  ) or exists (
    select 1 from public.discovery_bookings d
    where d.coach_id = r.coach_id
      and d.status = 'confirmed'
      and d.start_at < (r.new_end_at + make_interval(mins => v_buffer_minutes))
      and d.end_at > (r.new_start_at - make_interval(mins => v_buffer_minutes))
  ) then
    raise exception 'that slot was just taken';
  end if;

  update public.bookings
    set start_at = r.new_start_at, end_at = r.new_end_at, reminder_sent_at = null
    where id = r.booking_id;

  -- Same rule as a direct move (0277): inside the cancellation window the change is flagged for the coach to Charge or Waive.
  if (r.from_start_at - r.created_at) < make_interval(hours => v_window_hours) then
    update public.bookings set late_change_kind = 'reschedule', late_charge_state = 'flagged' where id = r.booking_id;
    select full_name into v_name from public.profiles where id = r.athlete_id;
    insert into public.notifications (profile_id, group_id, type, body, link_path)
    values (r.coach_id, r.group_id, 'late_change',
      coalesce(nullif(btrim(v_name), ''), 'A client') || ' moved a session inside the ' || v_window_hours::text || '-hour window. Charge it or waive it.',
      '/dashboard');
  end if;

  update public.booking_move_requests set status = 'confirmed', decided_at = now(), decided_by = auth.uid() where id = r.id;

  insert into public.notifications (profile_id, group_id, type, body, link_path)
  values (r.athlete_id, r.group_id, 'move_decision',
    'Your coach confirmed your new time: ' || to_char(r.new_start_at at time zone v_tz, 'Dy Mon FMDD, FMHH12:MI AM') || '.',
    '/groups/' || r.group_id::text || '/calendar');

  perform public.offer_freed_slot_to_waitlist(r.coach_id, v_b.start_at, v_b.end_at);
  return 'confirmed';
end;
$function$;

revoke all on function public.request_booking_move(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.request_booking_move(uuid, timestamptz, timestamptz) to authenticated, service_role;
revoke all on function public.resolve_move_request(uuid, boolean) from public, anon;
grant execute on function public.resolve_move_request(uuid, boolean) to authenticated, service_role;

-- ---- a client can no longer move a session directly while self-booking is off ----
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
  -- With self-booking off, a client asks for a move (request_booking_move) and the coach confirms; they cannot move the session themselves.
  if not coalesce((select bp.self_booking_enabled from public.coach_booking_policies bp where bp.coach_id = v_coach_id), false) then
    raise exception 'your coach confirms moves: ask for the new time instead';
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

commit;
