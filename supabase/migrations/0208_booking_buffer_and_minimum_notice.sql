-- acuity_replacement_gap_audit_sept16.md — the smallest, most additive
-- slice of the still-open Acuity-parity gaps (buffer time / minimum
-- notice / waitlists / recurring booking / credit-expiry). Design
-- already resolved: per-coach configurable settings on
-- coach_booking_policies, same shape as the existing
-- cancellation_window_hours column.
alter table public.coach_booking_policies
  add column buffer_minutes int not null default 0 check (buffer_minutes >= 0),
  add column minimum_notice_hours int not null default 0 check (minimum_notice_hours >= 0);

-- book_session (0125) reproduced byte-for-byte except for two new
-- guards: a buffer widens the existing overlap check by buffer_minutes
-- on both sides (a physical scheduling constraint — applies regardless
-- of who initiates the booking), and minimum notice rejects a
-- too-soon self-booking (gated on v_is_self, same as the existing
-- credit-balance check just below it — a coach booking a client
-- in-person isn't subject to their own notice rule).
create or replace function public.book_session(
  p_coach_id uuid,
  p_athlete_id uuid,
  p_group_id uuid,
  p_start_at timestamptz,
  p_end_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_self boolean;
  v_balance int;
  v_booking_id uuid;
  v_buffer_minutes int;
  v_minimum_notice_hours int;
begin
  v_is_self := auth.uid() = p_athlete_id;

  if not v_is_self and not public.is_group_coach(p_group_id) then
    raise exception 'not authorized to book this session';
  end if;

  if not public.is_training_client_of_group(p_group_id, p_athlete_id) then
    raise exception 'not a training client of this group';
  end if;

  if p_end_at <= p_start_at then
    raise exception 'invalid time range';
  end if;

  select coalesce(bp.buffer_minutes, 0), coalesce(bp.minimum_notice_hours, 0)
    into v_buffer_minutes, v_minimum_notice_hours
  from public.coach_booking_policies bp where bp.coach_id = p_coach_id;
  v_buffer_minutes := coalesce(v_buffer_minutes, 0);
  v_minimum_notice_hours := coalesce(v_minimum_notice_hours, 0);

  if v_is_self and (p_start_at - now()) < make_interval(hours => v_minimum_notice_hours) then
    raise exception 'that session needs more advance notice';
  end if;

  if v_is_self then
    select balance into v_balance from public.session_credits
      where athlete_id = p_athlete_id and group_id = p_group_id;
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

  insert into public.bookings (coach_id, athlete_id, group_id, start_at, end_at, status)
  values (p_coach_id, p_athlete_id, p_group_id, p_start_at, p_end_at, 'confirmed')
  returning id into v_booking_id;

  perform public.adjust_session_credits(p_athlete_id, p_group_id, -1);

  return v_booking_id;
end;
$$;

-- reschedule_booking (0207, just fixed to add the overlap guard)
-- reproduced byte-for-byte except for the same two new guards. Always
-- athlete-initiated (the existing auth.uid() <> v_athlete_id check
-- above already guarantees that), so minimum notice always applies
-- here — no coach-bypass branch needed.
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
  v_buffer_minutes int;
  v_minimum_notice_hours int;
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
    perform public.adjust_session_credits(v_athlete_id, v_group_id, -1);
  end if;
end;
$$;
