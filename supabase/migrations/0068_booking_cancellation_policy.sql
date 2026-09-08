-- Coach-wide cancellation/reschedule policy — same coach-scoped shape as
-- coach_availability_windows, not group-scoped, since one coach's policy
-- applies across every group/client they run.
create table public.coach_booking_policies (
  coach_id uuid primary key references public.profiles(id) on delete cascade,
  cancellation_window_hours int not null default 24 check (cancellation_window_hours >= 0),
  updated_at timestamptz not null default now()
);
alter table public.coach_booking_policies enable row level security;
create policy "booking_policies_coach_manage" on public.coach_booking_policies for all
  to authenticated using (coach_id = auth.uid()) with check (coach_id = auth.uid());
create policy "booking_policies_client_select" on public.coach_booking_policies for select
  to authenticated using (public.is_client_of_coach(coach_id));

-- Replaces the unconditional-refund version: a coach cancelling (their
-- call, not the client's) always refunds; an athlete cancelling their own
-- booking only gets the credit back when they're outside their coach's
-- cancellation window (defaults to 24h when the coach hasn't set one).
-- Cancelling late still cancels the booking — it just forfeits the credit,
-- matching a real no-show/late-cancel policy instead of silently refunding
-- every cancellation regardless of timing.
create or replace function public.cancel_booking_and_refund_credit(p_booking_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_athlete_id uuid;
  v_group_id uuid;
  v_coach_id uuid;
  v_status text;
  v_start_at timestamptz;
  v_window_hours int;
  v_is_athlete_cancelling boolean;
  v_should_refund boolean;
begin
  select athlete_id, group_id, coach_id, status, start_at
    into v_athlete_id, v_group_id, v_coach_id, v_status, v_start_at
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
    -- A coach-initiated cancellation is never the client's fault.
    v_should_refund := true;
  end if;

  update public.bookings set status = 'cancelled' where id = p_booking_id;

  if v_should_refund then
    insert into public.session_credits (athlete_id, group_id, balance)
    values (v_athlete_id, v_group_id, 1)
    on conflict (athlete_id, group_id)
    do update set balance = public.session_credits.balance + 1, updated_at = now();
  end if;
end;
$$;

-- Moves a confirmed booking to a new time. An on-time reschedule (outside
-- the coach's cancellation window, measured against the booking's
-- *current* start time) is free — no credit changes hands. A late
-- reschedule forfeits a credit, same consequence as a late cancellation,
-- since it's the client changing plans on short notice either way. The
-- existing partial unique index on (coach_id, start_at) still rejects a
-- collision with another confirmed booking at the new time.
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

  select coalesce(
    (select cancellation_window_hours from public.coach_booking_policies where coach_id = v_coach_id),
    24
  ) into v_window_hours;

  update public.bookings
    set start_at = p_new_start_at, end_at = p_new_end_at
    where id = p_booking_id;

  if (v_start_at - now()) < make_interval(hours => v_window_hours) then
    perform public.adjust_session_credits(v_athlete_id, v_group_id, -1);
  end if;
end;
$$;
