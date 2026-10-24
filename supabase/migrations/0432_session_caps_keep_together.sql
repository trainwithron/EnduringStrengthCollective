-- Session caps, "Keep my sessions together" and a lunch break (Ron, Oct 23: "if I go over 100 sessions a month, my rent goes up ... I need to limit my weekly sessions at 25" and "It would
-- recommend the most likely places that I would want to be booked at, which would be around another session or not on my lunch break").
--  * coach_booking_policies gains max_sessions_per_week / max_sessions_per_month (blank = no limit, 1-500), keep_together (off by default) and lunch_start / lunch_end.
--  * client_slot_reason(coach, start, end, ignore booking, direct): why a client may NOT have that time, or null when they may. Counted: the coach's own confirmed one-on-one
--    bookings (the hidden stand-in booking of a group class is not counted), in the coach's week (Sunday to Saturday) and month, on the coach's clock, across every organization.
--      'week_full' / 'month_full': the cap is reached.
--      For a DIRECT booking or move only (the coach approves a request, so "Request a different time" still works):
--      'lunch': inside the lunch break; 'not_offered': keep-together is on and the time is neither the nearest open time right before or right after a session already booked that
--      day (respecting the buffer), nor, on a day with nothing booked yet, one of the first 2 open times of the day.
--  * assert_client_slot_offered raises the reason in words; book_session, reschedule_booking (a client's own) and check_booking_request_slot (a client's request or move request)
--    call it right where they already check the coach's hours. A coach booking for a client is never refused: the cap is a warning on the coach's screen.
--  * client_slot_reasons(coach, starts[], ends[]): the same answer for the times a screen is about to offer, so a client is only ever offered what the server will accept.
-- The three functions are changed by adding one call each to their live text (checked first: the paste stops if the text is not the one this was written against). Re-runnable.

alter table public.coach_booking_policies add column if not exists max_sessions_per_week int;
alter table public.coach_booking_policies add column if not exists max_sessions_per_month int;
alter table public.coach_booking_policies add column if not exists keep_together boolean not null default false;
alter table public.coach_booking_policies add column if not exists lunch_start time;
alter table public.coach_booking_policies add column if not exists lunch_end time;

do $c$
begin
  if not exists (select 1 from pg_constraint where conname = 'coach_booking_policies_caps_ok' and conrelid = 'public.coach_booking_policies'::regclass) then
    alter table public.coach_booking_policies add constraint coach_booking_policies_caps_ok
      check ((max_sessions_per_week is null or max_sessions_per_week between 1 and 500) and (max_sessions_per_month is null or max_sessions_per_month between 1 and 500));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'coach_booking_policies_lunch_ok' and conrelid = 'public.coach_booking_policies'::regclass) then
    alter table public.coach_booking_policies add constraint coach_booking_policies_lunch_ok
      check ((lunch_start is null and lunch_end is null) or (lunch_start is not null and lunch_end is not null and lunch_start < lunch_end));
  end if;
end
$c$;

-- The coach's confirmed one-on-one sessions starting in [from, to), leaving out one booking (the one being moved) and the hidden stand-in booking of a group class.
create or replace function public.coach_session_count(p_coach_id uuid, p_from timestamptz, p_to timestamptz, p_ignore_booking_id uuid)
returns int
language sql
stable
security definer
set search_path to 'public'
as $function$
  select count(*)::int
  from public.bookings b
  where b.coach_id = p_coach_id
    and b.status = 'confirmed'
    and b.start_at >= p_from
    and b.start_at < p_to
    and (p_ignore_booking_id is null or b.id <> p_ignore_booking_id)
    and not exists (select 1 from public.group_sessions gs where gs.anchor_booking_id = b.id);
$function$;
revoke all on function public.coach_session_count(uuid, timestamptz, timestamptz, uuid) from public, anon, authenticated;

create or replace function public.client_slot_reason(p_coach_id uuid, p_start timestamptz, p_end timestamptz, p_ignore_booking_id uuid, p_direct boolean)
returns text
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  bp public.coach_booking_policies%rowtype;
  v_tz text;
  v_day date;
  v_day_start timestamptz;
  v_day_end timestamptz;
  v_week_start date;
  v_month_start date;
  v_buffer interval;
  v_has_sessions boolean;
  v_offered boolean;
begin
  select * into bp from public.coach_booking_policies where coach_id = p_coach_id;
  if not found then
    return null;
  end if;
  v_tz := coalesce(public.coach_time_zone(p_coach_id), 'America/New_York');
  v_day := (p_start at time zone v_tz)::date;

  -- The caps: the week (Sunday to Saturday) and the month holding the time, on the coach's clock.
  if bp.max_sessions_per_week is not null then
    v_week_start := v_day - extract(dow from v_day)::int;
    if public.coach_session_count(p_coach_id, (v_week_start::timestamp at time zone v_tz), ((v_week_start + 7)::timestamp at time zone v_tz), p_ignore_booking_id) >= bp.max_sessions_per_week then
      return 'week_full';
    end if;
  end if;
  if bp.max_sessions_per_month is not null then
    v_month_start := date_trunc('month', v_day)::date;
    if public.coach_session_count(p_coach_id, (v_month_start::timestamp at time zone v_tz), ((v_month_start + interval '1 month')::date::timestamp at time zone v_tz), p_ignore_booking_id) >= bp.max_sessions_per_month then
      return 'month_full';
    end if;
  end if;

  if not p_direct then
    return null;
  end if;

  -- The lunch break is never offered.
  if bp.lunch_start is not null and bp.lunch_end is not null
     and (p_start at time zone v_tz)::time < bp.lunch_end and (p_end at time zone v_tz)::time > bp.lunch_start then
    return 'lunch';
  end if;

  if not coalesce(bp.keep_together, false) then
    return null;
  end if;

  -- Keep my sessions together: the day's open times (the coach's windows, stepped and sized as the screens make them, clear of time off and the lunch break), then only the nearest
  -- free one right before and right after each session already booked that day; with nothing booked yet, the first 2.
  v_day_start := v_day::timestamp at time zone v_tz;
  v_day_end := (v_day + 1)::timestamp at time zone v_tz;
  v_buffer := make_interval(mins => coalesce(bp.buffer_minutes, 0));

  select exists (
    select 1 from public.bookings b
    where b.coach_id = p_coach_id and b.status = 'confirmed' and b.start_at < v_day_end and b.end_at > v_day_start
      and (p_ignore_booking_id is null or b.id <> p_ignore_booking_id)
  ) into v_has_sessions;

  if not v_has_sessions then
    select exists (
      select 1 from (
        select c.cs from (
          select distinct s.s as cs
          from public.coach_availability_windows w
          cross join lateral generate_series(
            (v_day + w.start_time)::timestamp at time zone v_tz,
            ((v_day + w.end_time)::timestamp at time zone v_tz) - make_interval(mins => coalesce(w.session_minutes, w.slot_duration_minutes)),
            make_interval(mins => w.slot_duration_minutes)
          ) as s(s)
          where w.coach_id = p_coach_id and w.weekday = extract(dow from v_day)::int and w.slot_duration_minutes > 0
            and public.coach_time_is_open(p_coach_id, s.s, s.s + make_interval(mins => coalesce(w.session_minutes, w.slot_duration_minutes)))
            and not (bp.lunch_start is not null and bp.lunch_end is not null
                     and (s.s at time zone v_tz)::time < bp.lunch_end
                     and ((s.s + make_interval(mins => coalesce(w.session_minutes, w.slot_duration_minutes))) at time zone v_tz)::time > bp.lunch_start)
        ) c
        order by c.cs
        limit 2
      ) first_two
      where first_two.cs = p_start
    ) into v_offered;
  else
    with day_bookings as (
      select b.start_at, b.end_at from public.bookings b
      where b.coach_id = p_coach_id and b.status = 'confirmed' and b.start_at < v_day_end and b.end_at > v_day_start
        and (p_ignore_booking_id is null or b.id <> p_ignore_booking_id)
    ),
    open_candidates as (
      select distinct s.s as cs, s.s + make_interval(mins => coalesce(w.session_minutes, w.slot_duration_minutes)) as ce
      from public.coach_availability_windows w
      cross join lateral generate_series(
        (v_day + w.start_time)::timestamp at time zone v_tz,
        ((v_day + w.end_time)::timestamp at time zone v_tz) - make_interval(mins => coalesce(w.session_minutes, w.slot_duration_minutes)),
        make_interval(mins => w.slot_duration_minutes)
      ) as s(s)
      where w.coach_id = p_coach_id and w.weekday = extract(dow from v_day)::int and w.slot_duration_minutes > 0
        and public.coach_time_is_open(p_coach_id, s.s, s.s + make_interval(mins => coalesce(w.session_minutes, w.slot_duration_minutes)))
        and not (bp.lunch_start is not null and bp.lunch_end is not null
                 and (s.s at time zone v_tz)::time < bp.lunch_end
                 and ((s.s + make_interval(mins => coalesce(w.session_minutes, w.slot_duration_minutes))) at time zone v_tz)::time > bp.lunch_start)
        and not exists (select 1 from day_bookings d where d.start_at < s.s + make_interval(mins => coalesce(w.session_minutes, w.slot_duration_minutes)) + v_buffer and d.end_at > s.s - v_buffer)
    ),
    offered as (
      select (select min(o.cs) from open_candidates o where o.cs >= d.end_at + v_buffer) as cs from day_bookings d
      union
      select (select max(o.cs) from open_candidates o where o.ce <= d.start_at - v_buffer) as cs from day_bookings d
    )
    select exists (select 1 from offered where offered.cs = p_start) into v_offered;
  end if;

  return case when v_offered then null else 'not_offered' end;
end;
$function$;
revoke all on function public.client_slot_reason(uuid, timestamptz, timestamptz, uuid, boolean) from public, anon, authenticated;

-- The reason in words, for the booking functions (returns true, or refuses).
create or replace function public.assert_client_slot_offered(p_coach_id uuid, p_start timestamptz, p_end timestamptz, p_ignore_booking_id uuid, p_direct boolean)
returns boolean
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_reason text := public.client_slot_reason(p_coach_id, p_start, p_end, p_ignore_booking_id, p_direct);
begin
  if v_reason = 'week_full' then
    raise exception 'your coach is fully booked that week';
  elsif v_reason = 'month_full' then
    raise exception 'your coach is fully booked that month';
  elsif v_reason = 'lunch' then
    raise exception 'that time is your coach''s lunch break';
  elsif v_reason = 'not_offered' then
    raise exception 'that time is not one your coach offers; pick one of the times shown';
  end if;
  return true;
end;
$function$;
revoke all on function public.assert_client_slot_offered(uuid, timestamptz, timestamptz, uuid, boolean) from public, anon, authenticated;

-- For the screens: why each of these times can't be offered (null = it can), for a person who trains with this coach (or the coach, or the server). Direct booking rules; a client
-- moving a session passes it, so it is not counted (as reschedule_booking does).
create or replace function public.client_slot_reasons(p_coach_id uuid, p_starts timestamptz[], p_ends timestamptz[], p_ignore_booking_id uuid default null)
returns text[]
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_out text[] := '{}';
  i int;
begin
  if auth.role() is distinct from 'service_role' then
    if auth.uid() is null then
      raise exception 'not authorized';
    end if;
    if auth.uid() <> p_coach_id and not exists (
      select 1 from public.group_memberships me
      join public.group_memberships c on c.group_id = me.group_id and c.profile_id = p_coach_id and c.role = 'coach'
      where me.profile_id = auth.uid()
    ) then
      raise exception 'not authorized';
    end if;
  end if;
  if p_starts is null or p_ends is null or cardinality(p_starts) <> cardinality(p_ends) or cardinality(p_starts) > 400 then
    raise exception 'bad_request';
  end if;
  for i in 1 .. coalesce(cardinality(p_starts), 0) loop
    v_out := v_out || public.client_slot_reason(p_coach_id, p_starts[i], p_ends[i], p_ignore_booking_id, true);
  end loop;
  return v_out;
end;
$function$;
revoke all on function public.client_slot_reasons(uuid, timestamptz[], timestamptz[], uuid) from public, anon;
grant execute on function public.client_slot_reasons(uuid, timestamptz[], timestamptz[], uuid) to authenticated, service_role;

-- The signed-in coach's own count for a range (the "25 of 25 this week" line on their screens), counted exactly as the caps count, across every organization.
create or replace function public.my_session_count(p_from timestamptz, p_to timestamptz)
returns int
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
begin
  if auth.uid() is null then
    raise exception 'not authorized';
  end if;
  return public.coach_session_count(auth.uid(), p_from, p_to, null);
end;
$function$;
revoke all on function public.my_session_count(timestamptz, timestamptz) from public, anon;
grant execute on function public.my_session_count(timestamptz, timestamptz) to authenticated;

-- The three client paths: one call added to each, right where the coach's hours are checked (a function's live text, checked first, then changed in place).
do $patch$
declare
  v_def text;
  v_old text;
  v_new text;
  r record;
begin
  for r in
    select * from (values
      ('public.book_session(uuid,uuid,uuid,timestamp with time zone,timestamp with time zone)'::regprocedure,
       'public.coach_time_is_open(p_coach_id, p_start_at, p_end_at)',
       '(public.coach_time_is_open(p_coach_id, p_start_at, p_end_at) and public.assert_client_slot_offered(p_coach_id, p_start_at, p_end_at, null::uuid, true))'),
      ('public.reschedule_booking(uuid,timestamp with time zone,timestamp with time zone)'::regprocedure,
       'public.coach_time_is_open(v_coach_id, p_new_start_at, p_new_end_at)',
       '(public.coach_time_is_open(v_coach_id, p_new_start_at, p_new_end_at) and public.assert_client_slot_offered(v_coach_id, p_new_start_at, p_new_end_at, p_booking_id, true))'),
      ('public.check_booking_request_slot(uuid,uuid,timestamp with time zone,timestamp with time zone)'::regprocedure,
       'public.coach_time_is_open(p_coach_id, p_start, p_end)',
       '(public.coach_time_is_open(p_coach_id, p_start, p_end) and public.assert_client_slot_offered(p_coach_id, p_start, p_end, p_ignore_booking_id, false))')
    ) as t(fn, old_text, new_text)
  loop
    v_def := pg_get_functiondef(r.fn);
    if position('assert_client_slot_offered' in v_def) > 0 then
      continue; -- already changed (re-run)
    end if;
    if (length(v_def) - length(replace(v_def, r.old_text, ''))) / length(r.old_text) <> 1 then
      raise exception '% does not contain the hours check exactly once; NOTHING was changed.', r.fn;
    end if;
    execute replace(v_def, r.old_text, r.new_text);
  end loop;
end
$patch$;
