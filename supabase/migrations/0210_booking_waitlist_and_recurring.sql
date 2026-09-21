-- acuity_replacement_gap_audit_sept16.md — the last two Acuity-parity
-- gaps, per Ron's own confirmed answers (waitlists_and_recurring_
-- bookings_scoping_sept21.md): soft-priority waitlist offers,
-- specific-slot only, recurring series capped at 12 occurrences,
-- availability conflicts flagged for the coach to resolve (never
-- silently auto-cancelled or silently left to double-book).

-- ============================================================
-- Waitlists
-- ============================================================
create table public.booking_waitlist_entries (
  id uuid primary key default uuid_generate_v4(),
  coach_id uuid not null references public.profiles(id) on delete cascade,
  athlete_id uuid not null references public.profiles(id) on delete cascade,
  group_id uuid not null references public.groups(id) on delete cascade,
  slot_start_at timestamptz not null,
  slot_end_at timestamptz not null,
  status text not null default 'waiting' check (status in ('waiting', 'offered', 'claimed', 'expired', 'cancelled')),
  offered_at timestamptz,
  offer_expires_at timestamptz,
  push_sent_at timestamptz,
  created_at timestamptz not null default now(),
  unique (athlete_id, coach_id, slot_start_at)
);
create index booking_waitlist_entries_slot_idx on public.booking_waitlist_entries(coach_id, slot_start_at, status);
create index booking_waitlist_entries_athlete_idx on public.booking_waitlist_entries(athlete_id);

alter table public.booking_waitlist_entries enable row level security;

create policy "booking_waitlist_entries_select_own_or_coach" on public.booking_waitlist_entries for select
  to authenticated using (athlete_id = (select auth.uid()) or public.is_group_coach(group_id));

create policy "booking_waitlist_entries_insert_self_or_coach" on public.booking_waitlist_entries for insert
  to authenticated with check (
    (athlete_id = (select auth.uid()) and public.is_training_client_of_group(group_id))
    or public.is_group_coach(group_id)
  );

-- The only client-writable transition: leaving the waitlist voluntarily
-- (waiting -> cancelled). Every other transition (offered/claimed/
-- expired) is system-driven from inside the security-definer RPCs
-- below, which run as the table owner and aren't subject to this
-- policy at all — same precedent as book_session's own raw INSERT into
-- `bookings` despite that table's own restrictive RLS.
create policy "booking_waitlist_entries_leave_own_or_coach" on public.booking_waitlist_entries for update
  to authenticated
  using ((athlete_id = (select auth.uid()) or public.is_group_coach(group_id)) and status = 'waiting')
  with check (status = 'cancelled');

-- Real, visible join action — only makes sense for a slot that's
-- genuinely taken right now. Idempotent: re-joining an already-waiting/
-- offered entry just returns the existing row; re-joining after
-- expiring/cancelling resets it to a fresh 'waiting' entry.
create or replace function public.join_booking_waitlist(
  p_coach_id uuid,
  p_athlete_id uuid,
  p_group_id uuid,
  p_slot_start_at timestamptz,
  p_slot_end_at timestamptz
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entry_id uuid;
begin
  if auth.uid() <> p_athlete_id and not public.is_group_coach(p_group_id) then
    raise exception 'not authorized to join this waitlist';
  end if;

  if not public.is_training_client_of_group(p_group_id, p_athlete_id) then
    raise exception 'not a training client of this group';
  end if;

  if not exists (
    select 1 from public.bookings b
    where b.coach_id = p_coach_id and b.status = 'confirmed'
      and b.start_at = p_slot_start_at and b.end_at = p_slot_end_at
  ) then
    raise exception 'that slot is not currently booked';
  end if;

  insert into public.booking_waitlist_entries (coach_id, athlete_id, group_id, slot_start_at, slot_end_at)
  values (p_coach_id, p_athlete_id, p_group_id, p_slot_start_at, p_slot_end_at)
  on conflict (athlete_id, coach_id, slot_start_at) do update
    set status = 'waiting', offered_at = null, offer_expires_at = null, push_sent_at = null
    where booking_waitlist_entries.status in ('expired', 'cancelled')
  returning id into v_entry_id;

  if v_entry_id is null then
    select id into v_entry_id from public.booking_waitlist_entries
      where athlete_id = p_athlete_id and coach_id = p_coach_id and slot_start_at = p_slot_start_at;
  end if;

  return v_entry_id;
end;
$$;
grant execute on function public.join_booking_waitlist(uuid, uuid, uuid, timestamptz, timestamptz) to authenticated;

-- Shared by cancel/reschedule below (a slot freeing up) and the offer-
-- expiration cron (cascading to the next person). Soft priority only —
-- per Ron's own confirmed answer, this never hard-reserves the slot or
-- spends a credit before the offered athlete actually confirms; it's a
-- real notification with a head start, not a credit hold. Whoever
-- actually calls book_session first gets the slot, offered athlete or
-- not, via the exact same overlap guard already protecting every
-- booking in this app.
create or replace function public.offer_freed_slot_to_waitlist(
  p_coach_id uuid,
  p_start_at timestamptz,
  p_end_at timestamptz
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entry record;
begin
  select * into v_entry from public.booking_waitlist_entries
    where coach_id = p_coach_id and slot_start_at = p_start_at and slot_end_at = p_end_at and status = 'waiting'
    order by created_at asc
    limit 1;

  if v_entry.id is null then
    return;
  end if;

  update public.booking_waitlist_entries
    set status = 'offered', offered_at = now(), offer_expires_at = now() + interval '30 minutes'
    where id = v_entry.id;

  insert into public.notifications (profile_id, group_id, type, body, link_path)
  values (
    v_entry.athlete_id,
    v_entry.group_id,
    'waitlist_slot_offered',
    'A spot just opened up for ' || to_char(p_start_at, 'Dy Mon DD, HH12:MI AM') || ' — book now before it''s gone.',
    '/groups/' || v_entry.group_id || '/calendar/' || to_char(p_start_at, 'YYYY-MM-DD')
  );
end;
$$;

-- Widen notifications.type for the two new real, group-scoped types
-- this feature needs.
alter table public.notifications drop constraint notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in (
    'comment', 'program_assigned', 'macros_assigned', 'partner_request',
    'partner_request_accepted', 'milestone_celebration', 'gym_visitor_lead',
    'trainer_dispatch_offer', 'trainer_dispatch_question', 'session_pattern_note',
    'credits_expired', 'waitlist_slot_offered', 'recurring_booking_conflict'
  ));

-- book_session (0208) reproduced byte-for-byte plus the one new block at
-- the end: a successful booking claims the booker's own waiting/offered
-- entry for this exact slot and expires everyone else's (the slot's
-- taken again, their wait is over one way or the other).
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

  update public.booking_waitlist_entries
    set status = case when athlete_id = p_athlete_id then 'claimed' else 'expired' end
    where coach_id = p_coach_id
      and slot_start_at = p_start_at
      and slot_end_at = p_end_at
      and status in ('waiting', 'offered');

  return v_booking_id;
end;
$$;

-- cancel_booking_and_refund_credit (0064) reproduced plus offering the
-- freed slot to the waitlist.
create or replace function public.cancel_booking_and_refund_credit(p_booking_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_athlete_id uuid;
  v_group_id uuid;
  v_coach_id uuid;
  v_status text;
  v_start_at timestamptz;
  v_end_at timestamptz;
  v_window_hours int;
  v_is_athlete_cancelling boolean;
  v_should_refund boolean;
begin
  select athlete_id, group_id, coach_id, status, start_at, end_at
    into v_athlete_id, v_group_id, v_coach_id, v_status, v_start_at, v_end_at
  from public.bookings where id = p_booking_id;

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

  if v_should_refund then
    insert into public.session_credits (athlete_id, group_id, balance)
    values (v_athlete_id, v_group_id, 1)
    on conflict (athlete_id, group_id)
    do update set balance = public.session_credits.balance + 1, updated_at = now();
  end if;

  perform public.offer_freed_slot_to_waitlist(v_coach_id, v_start_at, v_end_at);
end;
$$;

-- reschedule_booking (0208) reproduced plus offering the OLD (now-freed)
-- slot to the waitlist.
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
  v_end_at timestamptz;
  v_window_hours int;
  v_buffer_minutes int;
  v_minimum_notice_hours int;
begin
  select athlete_id, group_id, coach_id, status, start_at, end_at
    into v_athlete_id, v_group_id, v_coach_id, v_status, v_start_at, v_end_at
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

  perform public.offer_freed_slot_to_waitlist(v_coach_id, v_start_at, v_end_at);
end;
$$;

-- ============================================================
-- Recurring bookings
-- ============================================================
create table public.recurring_booking_series (
  id uuid primary key default uuid_generate_v4(),
  coach_id uuid not null references public.profiles(id) on delete cascade,
  athlete_id uuid not null references public.profiles(id) on delete cascade,
  group_id uuid not null references public.groups(id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6),
  start_time time not null,
  duration_minutes int not null check (duration_minutes > 0),
  occurrences_total int not null check (occurrences_total > 0 and occurrences_total <= 12),
  status text not null default 'active' check (status in ('active', 'cancelled')),
  created_at timestamptz not null default now()
);
create index recurring_booking_series_athlete_idx on public.recurring_booking_series(athlete_id);
create index recurring_booking_series_coach_idx on public.recurring_booking_series(coach_id);

alter table public.recurring_booking_series enable row level security;
create policy "recurring_booking_series_select_own_or_coach" on public.recurring_booking_series for select
  to authenticated using (athlete_id = (select auth.uid()) or public.is_group_coach(group_id));
-- No authenticated insert/update policy — the series header is only
-- ever written by create_recurring_booking_series (security definer)
-- and the cancel-series RPC below; direct client writes to this table
-- are never legitimate.

alter table public.bookings
  add column recurring_series_id uuid references public.recurring_booking_series(id) on delete set null,
  add column needs_coach_resolution boolean not null default false;

-- Generates every occurrence via real book_session calls — reuses its
-- entire safety net (auth, credit balance, overlap/buffer/notice) rather
-- than duplicating any of it. One occurrence failing (a conflict, out of
-- credits) doesn't abort the rest; booked_count/failed_count report the
-- real outcome so the caller can show an honest summary, matching this
-- app's own established "report partial success, don't pretend it was
-- all-or-nothing" convention (e.g. Assign to Position's own bulk result).
create or replace function public.create_recurring_booking_series(
  p_coach_id uuid,
  p_athlete_id uuid,
  p_group_id uuid,
  p_first_start_at timestamptz,
  p_duration_minutes int,
  p_occurrences_total int
) returns table(series_id uuid, booked_count int, failed_count int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_series_id uuid;
  v_start_at timestamptz;
  v_end_at timestamptz;
  v_new_booking_id uuid;
  v_booked int := 0;
  v_failed int := 0;
  i int;
begin
  if auth.uid() <> p_athlete_id and not public.is_group_coach(p_group_id) then
    raise exception 'not authorized to create this booking series';
  end if;
  if p_occurrences_total <= 0 or p_occurrences_total > 12 then
    raise exception 'occurrences_total must be between 1 and 12';
  end if;

  insert into public.recurring_booking_series (coach_id, athlete_id, group_id, weekday, start_time, duration_minutes, occurrences_total)
  values (p_coach_id, p_athlete_id, p_group_id, extract(dow from p_first_start_at)::smallint, p_first_start_at::time, p_duration_minutes, p_occurrences_total)
  returning id into v_series_id;

  for i in 0..(p_occurrences_total - 1) loop
    v_start_at := p_first_start_at + (i * interval '7 days');
    v_end_at := v_start_at + make_interval(mins => p_duration_minutes);
    begin
      v_new_booking_id := public.book_session(p_coach_id, p_athlete_id, p_group_id, v_start_at, v_end_at);
      update public.bookings set recurring_series_id = v_series_id where id = v_new_booking_id;
      v_booked := v_booked + 1;
    exception when others then
      v_failed := v_failed + 1;
    end;
  end loop;

  return query select v_series_id, v_booked, v_failed;
end;
$$;
grant execute on function public.create_recurring_booking_series(uuid, uuid, uuid, timestamptz, int, int) to authenticated;

-- Cancels every future, not-yet-occurred occurrence in the series
-- (reuses cancel_booking_and_refund_credit's own real refund logic per
-- occurrence, unchanged) — an explicit, separate action, never a side
-- effect of cancelling a single occurrence.
create or replace function public.cancel_recurring_booking_series(p_series_id uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_athlete_id uuid;
  v_group_id uuid;
  v_booking record;
  v_cancelled int := 0;
begin
  select athlete_id, group_id into v_athlete_id, v_group_id
  from public.recurring_booking_series where id = p_series_id;

  if v_athlete_id is null then
    raise exception 'series not found';
  end if;
  if auth.uid() <> v_athlete_id and not public.is_group_coach(v_group_id) then
    raise exception 'not authorized to cancel this series';
  end if;

  update public.recurring_booking_series set status = 'cancelled' where id = p_series_id;

  for v_booking in
    select id from public.bookings
    where recurring_series_id = p_series_id and status = 'confirmed' and start_at > now()
  loop
    perform public.cancel_booking_and_refund_credit(v_booking.id);
    v_cancelled := v_cancelled + 1;
  end loop;

  return v_cancelled;
end;
$$;
grant execute on function public.cancel_recurring_booking_series(uuid) to authenticated;

-- Coach-only: either drop the flag (coach reviewed it, will honor the
-- slot manually despite the availability change) or cancel just that
-- one occurrence (reuses the real refund RPC, unchanged).
create or replace function public.resolve_recurring_booking_conflict(p_booking_id uuid, p_cancel boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group_id uuid;
begin
  select group_id into v_group_id from public.bookings where id = p_booking_id;
  if v_group_id is null then
    raise exception 'booking not found';
  end if;
  if not public.is_group_coach(v_group_id) then
    raise exception 'not authorized to resolve this conflict';
  end if;

  if p_cancel then
    perform public.cancel_booking_and_refund_credit(p_booking_id);
  else
    update public.bookings set needs_coach_resolution = false where id = p_booking_id;
  end if;
end;
$$;
grant execute on function public.resolve_recurring_booking_conflict(uuid, boolean) to authenticated;
