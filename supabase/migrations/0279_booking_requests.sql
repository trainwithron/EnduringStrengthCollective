-- Booking requests (Ron, Oct 6): in 'request' mode a client asks for a NEW session or asks to MOVE one, and the session is only booked or moved when the
-- coach confirms. One mechanism and one panel (Needs your decision) for both.
--
--  * booking_requests: kind 'new' or 'move'. Status: pending, confirmed, declined, expired, cancelled. Read by the client and the coach; written
--    only through the functions below. No slot is held while a request is pending, so a pending request never blocks the calendar. A client has
--    at most 3 pending requests, and only one per session being moved.
--  * coach_time_is_open(coach, start, end): the same rule the screens use: inside one of the coach's weekly hours (in the coach's time zone,
--    America/New_York when none is set) and not inside time off.
--  * request_booking(coach, athlete, group, start, end) and request_booking_move(booking, new_start, new_end): the client asks. Both need the
--    coach's mode to be 'request', check notice, hours and time off, and that the slot is free with the buffer, then notify the coach.
--  * resolve_booking_request(request, confirm): the coach (or an org owner or admin) decides and gets 'confirmed', 'declined', 'closed' (the
--    session was cancelled or moved meanwhile, or has started) or 'slot_taken' (someone else took the time; the request is declined and the
--    client told). Confirm creates the booking (unsettled, like any coach-scheduled session) or moves it, applies the late-change flag from
--    0277 to a move asked for inside the window (judged when the client ASKED), updates the waiting list, and tells the client. Confirm does not
--    re-check hours or time off: the coach is deciding; the screen warns when it is outside.
--  * cancel_booking_request(request): the client withdraws a pending request.
--  * expire_stale_booking_requests(): service role only (the 5-minute waiting-list job calls it). A pending request whose time has passed
--    becomes expired and the client is told.
--  * reschedule_booking: the 0277 text plus the mode check above.
--  * the notification type list gains booking_request and request_decision.
-- Needs 0277 and 0278. Re-running replaces the functions again.

alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in (
    'comment', 'program_assigned', 'macros_assigned', 'partner_request',
    'partner_request_accepted', 'milestone_celebration', 'gym_visitor_lead',
    'trainer_dispatch_offer', 'trainer_dispatch_question', 'session_pattern_note',
    'credits_expired', 'waitlist_slot_offered', 'recurring_booking_conflict',
    'email_changed', 'direct_message', 'late_change', 'booking_request', 'request_decision'
  ));

create table if not exists public.booking_requests (
  id uuid primary key default uuid_generate_v4(),
  kind text not null check (kind in ('new', 'move')),
  booking_id uuid references public.bookings(id) on delete cascade, -- the session being moved (kind 'move' only)
  athlete_id uuid not null references public.profiles(id) on delete cascade,
  coach_id uuid not null references public.profiles(id) on delete cascade,
  group_id uuid not null references public.groups(id) on delete cascade,
  from_start_at timestamptz, -- where the session was when the client asked (kind 'move' only)
  new_start_at timestamptz not null,
  new_end_at timestamptz not null check (new_end_at > new_start_at),
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'declined', 'expired', 'cancelled')),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid references public.profiles(id) on delete set null,
  check ((kind = 'move' and booking_id is not null and from_start_at is not null) or (kind = 'new' and booking_id is null))
);
create unique index if not exists booking_requests_one_pending_move on public.booking_requests (booking_id) where status = 'pending' and kind = 'move';
create unique index if not exists booking_requests_one_pending_time on public.booking_requests (athlete_id, coach_id, new_start_at) where status = 'pending';
create index if not exists booking_requests_coach_pending on public.booking_requests (coach_id) where status = 'pending';

alter table public.booking_requests enable row level security;
drop policy if exists "booking_requests_select_participants" on public.booking_requests;
create policy "booking_requests_select_participants" on public.booking_requests for select
  to authenticated using (athlete_id = (select auth.uid()) or coach_id = (select auth.uid()) or public.is_group_coach(group_id));
-- No insert, update or delete policy for signed-in users: requests are created and decided only by the functions below.

create or replace function public.coach_time_is_open(p_coach_id uuid, p_start timestamp with time zone, p_end timestamp with time zone)
returns boolean
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_tz text;
  v_ls timestamp;
  v_le timestamp;
begin
  select coalesce(pr.timezone, 'America/New_York') into v_tz from public.profiles pr where pr.id = p_coach_id;
  if v_tz is null or not exists (select 1 from pg_timezone_names where name = v_tz) then
    v_tz := 'America/New_York';
  end if;
  v_ls := p_start at time zone v_tz;
  v_le := p_end at time zone v_tz;
  if v_ls::date <> v_le::date then
    return false;
  end if;
  if not exists (
    select 1 from public.coach_availability_windows w
    where w.coach_id = p_coach_id
      and w.weekday = extract(dow from v_ls)::int
      and w.start_time <= v_ls::time
      and w.end_time >= v_le::time
  ) then
    return false;
  end if;
  if exists (
    select 1 from public.coach_availability_exceptions e
    where e.coach_id = p_coach_id
      and (
        (e.kind = 'one_off' and e.start_at < p_end and e.end_at > p_start)
        or (e.kind = 'recurring' and e.weekday = extract(dow from v_ls)::int and e.start_time < v_le::time and e.end_time > v_ls::time)
      )
  ) then
    return false;
  end if;
  return true;
end;
$function$;

revoke all on function public.coach_time_is_open(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.coach_time_is_open(uuid, timestamptz, timestamptz) to authenticated, service_role;

-- Shared checks for both kinds of request: notice, hours and time off, and a free slot with the buffer.
create or replace function public.check_booking_request_slot(p_coach_id uuid, p_ignore_booking_id uuid, p_start timestamp with time zone, p_end timestamp with time zone)
returns void
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_buffer_minutes int;
  v_minimum_notice_hours int;
begin
  select coalesce(bp.buffer_minutes, 0), coalesce(bp.minimum_notice_hours, 0)
    into v_buffer_minutes, v_minimum_notice_hours
  from public.coach_booking_policies bp where bp.coach_id = p_coach_id;
  v_buffer_minutes := coalesce(v_buffer_minutes, 0);
  v_minimum_notice_hours := coalesce(v_minimum_notice_hours, 0);

  if p_end <= p_start then
    raise exception 'invalid time range';
  end if;
  if (p_start - now()) < make_interval(hours => v_minimum_notice_hours) then
    raise exception 'that session needs more advance notice';
  end if;
  if not public.coach_time_is_open(p_coach_id, p_start, p_end) then
    raise exception 'that time is outside your coach''s hours';
  end if;
  if exists (
    select 1 from public.bookings b
    where b.coach_id = p_coach_id
      and (p_ignore_booking_id is null or b.id <> p_ignore_booking_id)
      and b.status = 'confirmed'
      and b.start_at < (p_end + make_interval(mins => v_buffer_minutes))
      and b.end_at > (p_start - make_interval(mins => v_buffer_minutes))
  ) or exists (
    select 1 from public.discovery_bookings d
    where d.coach_id = p_coach_id
      and d.status = 'confirmed'
      and d.start_at < (p_end + make_interval(mins => v_buffer_minutes))
      and d.end_at > (p_start - make_interval(mins => v_buffer_minutes))
  ) then
    raise exception 'that slot was just taken';
  end if;
end;
$function$;

revoke all on function public.check_booking_request_slot(uuid, uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.check_booking_request_slot(uuid, uuid, timestamptz, timestamptz) to authenticated, service_role;

create or replace function public.request_booking(p_coach_id uuid, p_athlete_id uuid, p_group_id uuid, p_start_at timestamp with time zone, p_end_at timestamp with time zone)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_tz text;
  v_name text;
  v_request_id uuid;
begin
  if auth.uid() is null or auth.uid() <> p_athlete_id then
    raise exception 'not authorized to ask for this session';
  end if;
  if not exists (select 1 from public.group_memberships gm where gm.group_id = p_group_id and gm.profile_id = p_coach_id and gm.role = 'coach') then
    raise exception 'that coach does not coach this group';
  end if;
  if not public.is_training_client_of_group(p_group_id, p_athlete_id) then
    raise exception 'not a training client of this group';
  end if;
  if public.coach_booking_mode(p_coach_id) = 'free' then
    raise exception 'you can book this directly';
  elsif public.coach_booking_mode(p_coach_id) <> 'request' then
    raise exception 'your coach schedules your sessions';
  end if;
  if p_start_at <= now() then
    raise exception 'that time has already passed';
  end if;
  if (select count(*) from public.booking_requests where athlete_id = p_athlete_id and status = 'pending') >= 3 then
    raise exception 'you already have 3 requests waiting for your coach';
  end if;

  perform public.check_booking_request_slot(p_coach_id, null, p_start_at, p_end_at);

  begin
    insert into public.booking_requests (kind, athlete_id, coach_id, group_id, new_start_at, new_end_at)
    values ('new', p_athlete_id, p_coach_id, p_group_id, p_start_at, p_end_at)
    returning id into v_request_id;
  exception when unique_violation then
    raise exception 'you already asked for that time; your coach has not answered yet';
  end;

  select coalesce(pr.timezone, 'America/New_York') into v_tz from public.profiles pr where pr.id = p_coach_id;
  if v_tz is null or not exists (select 1 from pg_timezone_names where name = v_tz) then v_tz := 'America/New_York'; end if;
  select full_name into v_name from public.profiles where id = p_athlete_id;
  insert into public.notifications (profile_id, group_id, type, body, link_path)
  values (p_coach_id, p_group_id, 'booking_request',
    coalesce(nullif(btrim(v_name), ''), 'A client') || ' asked for a session on ' ||
      to_char(p_start_at at time zone v_tz, 'Dy Mon FMDD, FMHH12:MI AM') || '. Confirm or decline.',
    '/dashboard');
  return v_request_id;
end;
$function$;

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
  v_tz text;
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
  if v_start_at <= now() then
    raise exception 'that session has already started';
  end if;
  if public.coach_booking_mode(v_coach_id) = 'free' then
    raise exception 'you can move this directly';
  elsif public.coach_booking_mode(v_coach_id) <> 'request' then
    raise exception 'your coach schedules your sessions';
  end if;
  if (select count(*) from public.booking_requests where athlete_id = v_athlete_id and status = 'pending') >= 3 then
    raise exception 'you already have 3 requests waiting for your coach';
  end if;

  perform public.check_booking_request_slot(v_coach_id, p_booking_id, p_new_start_at, p_new_end_at);

  begin
    insert into public.booking_requests (kind, booking_id, athlete_id, coach_id, group_id, from_start_at, new_start_at, new_end_at)
    values ('move', p_booking_id, v_athlete_id, v_coach_id, v_group_id, v_start_at, p_new_start_at, p_new_end_at)
    returning id into v_request_id;
  exception when unique_violation then
    raise exception 'you already asked to move this session; your coach has not answered yet';
  end;

  select coalesce(pr.timezone, 'America/New_York') into v_tz from public.profiles pr where pr.id = v_coach_id;
  if v_tz is null or not exists (select 1 from pg_timezone_names where name = v_tz) then v_tz := 'America/New_York'; end if;
  select full_name into v_name from public.profiles where id = v_athlete_id;
  insert into public.notifications (profile_id, group_id, type, body, link_path)
  values (v_coach_id, v_group_id, 'booking_request',
    coalesce(nullif(btrim(v_name), ''), 'A client') || ' asked to move their ' ||
      to_char(v_start_at at time zone v_tz, 'Dy Mon FMDD, FMHH12:MI AM') || ' session to ' ||
      to_char(p_new_start_at at time zone v_tz, 'Dy Mon FMDD, FMHH12:MI AM') || '. Confirm or decline.',
    '/dashboard');
  return v_request_id;
end;
$function$;

create or replace function public.resolve_booking_request(p_request_id uuid, p_confirm boolean)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  r public.booking_requests%rowtype;
  v_b public.bookings%rowtype;
  v_buffer_minutes int;
  v_window_hours int;
  v_tz text;
  v_name text;
  v_new_id uuid;
  v_when text;
begin
  if auth.uid() is null and auth.role() is distinct from 'service_role' then
    raise exception 'not authorized';
  end if;

  select * into r from public.booking_requests where id = p_request_id for update;
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
  if v_tz is null or not exists (select 1 from pg_timezone_names where name = v_tz) then v_tz := 'America/New_York'; end if;
  v_when := to_char(r.new_start_at at time zone v_tz, 'Dy Mon FMDD, FMHH12:MI AM');

  if r.kind = 'move' then
    select * into v_b from public.bookings where id = r.booking_id for update;
    -- The session was cancelled, has started, or was moved some other way since the client asked: the request just closes.
    if v_b.id is null or v_b.status <> 'confirmed' or v_b.start_at <= now() or v_b.start_at <> r.from_start_at then
      update public.booking_requests set status = 'cancelled', decided_at = now(), decided_by = auth.uid() where id = r.id;
      return 'closed';
    end if;
  end if;

  if not p_confirm then
    update public.booking_requests set status = 'declined', decided_at = now(), decided_by = auth.uid() where id = r.id;
    insert into public.notifications (profile_id, group_id, type, body, link_path)
    values (r.athlete_id, r.group_id, 'request_decision',
      case when r.kind = 'move'
        then 'Your coach kept your session at ' || to_char(v_b.start_at at time zone v_tz, 'Dy Mon FMDD, FMHH12:MI AM') || '.'
        else 'Your coach could not do ' || v_when || '. You can ask for another time.' end,
      '/groups/' || r.group_id::text || '/calendar');
    return 'declined';
  end if;

  if r.new_start_at <= now() then
    update public.booking_requests set status = 'expired', decided_at = now(), decided_by = auth.uid() where id = r.id;
    return 'closed';
  end if;

  select coalesce(bp.buffer_minutes, 0), coalesce(bp.cancellation_window_hours, 24)
    into v_buffer_minutes, v_window_hours
  from public.coach_booking_policies bp where bp.coach_id = r.coach_id;
  v_buffer_minutes := coalesce(v_buffer_minutes, 0);
  v_window_hours := coalesce(v_window_hours, 24);

  -- Someone else took the time since the client asked: decline for the coach and tell the client, instead of leaving it pending forever.
  if exists (
    select 1 from public.bookings b
    where b.coach_id = r.coach_id
      and (r.booking_id is null or b.id <> r.booking_id)
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
    update public.booking_requests set status = 'declined', decided_at = now(), decided_by = auth.uid() where id = r.id;
    insert into public.notifications (profile_id, group_id, type, body, link_path)
    values (r.athlete_id, r.group_id, 'request_decision',
      v_when || ' was taken before your coach could confirm it. You can ask for another time.',
      '/groups/' || r.group_id::text || '/calendar');
    return 'slot_taken';
  end if;

  if r.kind = 'new' then
    if not public.is_training_client_of_group(r.group_id, r.athlete_id) then
      update public.booking_requests set status = 'cancelled', decided_at = now(), decided_by = auth.uid() where id = r.id;
      return 'closed';
    end if;
    -- Booked the way a coach books: no session is taken until it is attended.
    insert into public.bookings (coach_id, athlete_id, group_id, start_at, end_at, status, credit_state)
    values (r.coach_id, r.athlete_id, r.group_id, r.new_start_at, r.new_end_at, 'confirmed', 'unsettled')
    returning id into v_new_id;
    update public.booking_waitlist_entries
      set status = case when athlete_id = r.athlete_id then 'claimed' else 'expired' end
      where coach_id = r.coach_id and slot_start_at = r.new_start_at and slot_end_at = r.new_end_at and status in ('waiting', 'offered');
  else
    update public.bookings
      set start_at = r.new_start_at, end_at = r.new_end_at, reminder_sent_at = null
      where id = r.booking_id;
    -- Same rule as a direct move (0277), judged when the client ASKED: inside the cancellation window it is flagged for Charge or Waive.
    if (r.from_start_at - r.created_at) < make_interval(hours => v_window_hours) then
      update public.bookings set late_change_kind = 'reschedule', late_charge_state = 'flagged' where id = r.booking_id;
      select full_name into v_name from public.profiles where id = r.athlete_id;
      insert into public.notifications (profile_id, group_id, type, body, link_path)
      values (r.coach_id, r.group_id, 'late_change',
        coalesce(nullif(btrim(v_name), ''), 'A client') || ' moved a session inside the ' || v_window_hours::text || '-hour window. Charge it or waive it.',
        '/dashboard');
    end if;
    perform public.offer_freed_slot_to_waitlist(r.coach_id, v_b.start_at, v_b.end_at);
  end if;

  update public.booking_requests set status = 'confirmed', decided_at = now(), decided_by = auth.uid() where id = r.id;
  insert into public.notifications (profile_id, group_id, type, body, link_path)
  values (r.athlete_id, r.group_id, 'request_decision',
    case when r.kind = 'move' then 'Your coach confirmed your new time: ' else 'Your coach confirmed your session: ' end || v_when || '.',
    '/groups/' || r.group_id::text || '/calendar');
  return 'confirmed';
end;
$function$;

create or replace function public.cancel_booking_request(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_athlete uuid;
  v_status text;
begin
  select athlete_id, status into v_athlete, v_status from public.booking_requests where id = p_request_id for update;
  if v_athlete is null or auth.uid() is distinct from v_athlete then
    raise exception 'not authorized';
  end if;
  if v_status <> 'pending' then
    raise exception 'this request was already answered';
  end if;
  update public.booking_requests set status = 'cancelled', decided_at = now(), decided_by = auth.uid() where id = p_request_id;
end;
$function$;

-- A pending request whose time has passed stops waiting; the client is told. Called by the 5-minute waiting-list job (service role).
create or replace function public.expire_stale_booking_requests()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  r record;
  v_n integer := 0;
  v_tz text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not authorized';
  end if;
  for r in
    select * from public.booking_requests
    where status = 'pending' and (case when kind = 'move' then from_start_at else new_start_at end) <= now()
    for update
  loop
    update public.booking_requests set status = 'expired', decided_at = now() where id = r.id;
    select coalesce(pr.timezone, 'America/New_York') into v_tz from public.profiles pr where pr.id = r.coach_id;
    if v_tz is null or not exists (select 1 from pg_timezone_names where name = v_tz) then v_tz := 'America/New_York'; end if;
    insert into public.notifications (profile_id, group_id, type, body, link_path)
    values (r.athlete_id, r.group_id, 'request_decision',
      'Your request for ' || to_char(r.new_start_at at time zone v_tz, 'Dy Mon FMDD, FMHH12:MI AM') || ' was not answered in time, so it has lapsed. Message your coach if you still need it.',
      '/groups/' || r.group_id::text || '/calendar');
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$function$;

revoke all on function public.request_booking(uuid, uuid, uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.request_booking(uuid, uuid, uuid, timestamptz, timestamptz) to authenticated, service_role;
revoke all on function public.request_booking_move(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.request_booking_move(uuid, timestamptz, timestamptz) to authenticated, service_role;
revoke all on function public.resolve_booking_request(uuid, boolean) from public, anon;
grant execute on function public.resolve_booking_request(uuid, boolean) to authenticated, service_role;
revoke all on function public.cancel_booking_request(uuid) from public, anon;
grant execute on function public.cancel_booking_request(uuid) to authenticated, service_role;
revoke all on function public.expire_stale_booking_requests() from public, anon, authenticated;
grant execute on function public.expire_stale_booking_requests() to service_role;

-- ---- a client moves a session directly only in 'free' mode ----
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
