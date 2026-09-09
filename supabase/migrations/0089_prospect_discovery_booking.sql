-- Prospect self-booking: a stranger who isn't a client yet can book a
-- discovery call directly from a public, no-login page
-- (/book/[coachId]), the way Trainerize markets this as a named
-- business-development feature. Deliberately a separate table from
-- `bookings` rather than loosening that table's trust model — a
-- prospect has no account, no group membership, no session credits, and
-- their contact info (email/phone) is exactly the kind of thing that
-- must never become anon-readable, unlike everything else on a
-- confirmed booking today.
create table public.discovery_bookings (
  id uuid primary key default uuid_generate_v4(),
  coach_id uuid not null references public.profiles(id) on delete cascade,
  start_at timestamptz not null,
  end_at timestamptz not null,
  prospect_name text not null,
  prospect_email text not null,
  prospect_phone text,
  message text,
  status text not null default 'confirmed' check (status in ('confirmed', 'cancelled')),
  created_at timestamptz not null default now()
);

create unique index discovery_bookings_no_double_book
  on public.discovery_bookings (coach_id, start_at)
  where status = 'confirmed';

alter table public.discovery_bookings enable row level security;

-- No anon SELECT policy at all, on purpose — a prospect's name/email/
-- phone must never be publicly readable. The only way in is the RPC
-- below, which is security definer and never returns another prospect's
-- data; the only way to read a discovery booking back out is the coach
-- themselves, authenticated, via this policy.
create policy "discovery_bookings_coach_manage" on public.discovery_bookings for all
  to authenticated
  using (coach_id = auth.uid())
  with check (coach_id = auth.uid());

-- Public availability windows/exceptions are exposed only through a
-- server-side API route that computes real open slots (see
-- /api/discovery-availability/[coachId]) rather than new anon RLS
-- policies on coach_availability_windows/exceptions — keeps this
-- feature's anon surface to exactly one narrow write RPC and zero new
-- anon reads of coaching-schedule internals.

create or replace function public.book_discovery_call(
  p_coach_id uuid,
  p_start_at timestamptz,
  p_end_at timestamptz,
  p_prospect_name text,
  p_prospect_email text,
  p_prospect_phone text,
  p_message text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking_id uuid;
begin
  if p_end_at <= p_start_at then
    raise exception 'invalid time range';
  end if;
  if p_prospect_name is null or btrim(p_prospect_name) = '' then
    raise exception 'name is required';
  end if;
  if p_prospect_email is null or btrim(p_prospect_email) = '' then
    raise exception 'email is required';
  end if;
  if not exists (select 1 from public.profiles where id = p_coach_id) then
    raise exception 'coach not found';
  end if;

  -- Overlap guard against BOTH real client bookings and other discovery
  -- bookings for this coach — a prospect can't take a slot a real client
  -- already has, and (via the matching check added to book_session
  -- below) a real client can't take a slot a prospect already claimed.
  if exists (
    select 1 from public.bookings b
    where b.coach_id = p_coach_id and b.status = 'confirmed'
      and b.start_at < p_end_at and b.end_at > p_start_at
  ) or exists (
    select 1 from public.discovery_bookings d
    where d.coach_id = p_coach_id and d.status = 'confirmed'
      and d.start_at < p_end_at and d.end_at > p_start_at
  ) then
    raise exception 'that slot was just taken';
  end if;

  insert into public.discovery_bookings (
    coach_id, start_at, end_at, prospect_name, prospect_email, prospect_phone, message
  ) values (
    p_coach_id, p_start_at, p_end_at,
    btrim(p_prospect_name), btrim(p_prospect_email),
    nullif(btrim(coalesce(p_prospect_phone, '')), ''),
    nullif(btrim(coalesce(p_message, '')), '')
  )
  returning id into v_booking_id;

  return v_booking_id;
end;
$$;

-- The only anon grant this whole feature needs — a scalar return, no
-- table-level SELECT grant required for a security-definer function to
-- read/write internally.
grant execute on function public.book_discovery_call(uuid, timestamptz, timestamptz, text, text, text, text) to anon, authenticated;

-- Extend the existing client-booking RPC's overlap guard to also block
-- against a slot a prospect already claimed — without this, a real
-- client could book directly over a pending discovery call.
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
begin
  v_is_self := auth.uid() = p_athlete_id;

  if not v_is_self and not public.is_group_coach(p_group_id) then
    raise exception 'not authorized to book this session';
  end if;

  if not public.is_client_of_coach(p_coach_id) then
    raise exception 'not a client of this coach';
  end if;

  if p_end_at <= p_start_at then
    raise exception 'invalid time range';
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
      and b.start_at < p_end_at
      and b.end_at > p_start_at
  ) or exists (
    select 1 from public.discovery_bookings d
    where d.coach_id = p_coach_id
      and d.status = 'confirmed'
      and d.start_at < p_end_at
      and d.end_at > p_start_at
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
