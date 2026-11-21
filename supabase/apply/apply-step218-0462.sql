-- PASTE: step 218 (wave 3: calendar and requests. Request lapse warnings, quiet hours for new clients, the private calendar link, and paid booking on the public page). Paste all of it into the Supabase SQL editor and run. Last result: one row, all true.

begin;

-- Wave 3, calendar and requests (Ron, Nov 20). Re-running is safe.

-- C1: a coach is warned about two hours before a waiting session request lapses, and told once it has (lib/request-lapse-job.ts, run by the five-minute booking job). When
-- a request lapses is unchanged (expire_stale_booking_requests). Each message is claimed once on the request, so it goes out once.
alter table public.booking_requests add column if not exists lapse_warned_at timestamptz;
alter table public.booking_requests add column if not exists lapse_told_at timestamptz;

-- R8: a NEW client starts with quiet hours on, 9 PM to 7 AM in their own time zone, or their coach's when theirs is not known (Ron, Nov 20). Changeable in their Settings as
-- today. Only accounts made from now on: a marker column is added false for every existing profile, then its default turns true, so only rows made after this step carry it.
-- The hours are set the first time such a person joins a group as a client (a profile does not say "client" before then), and only when they are not a coach anywhere, have no
-- organization seat, and have not set quiet hours of their own. Coaches are never touched. Once applied (or skipped) the marker is cleared, so it happens at most once.
alter table public.profiles add column if not exists quiet_hours_default_pending boolean not null default false;
alter table public.profiles alter column quiet_hours_default_pending set default true;

create or replace function public.default_new_client_quiet_hours()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_coach uuid;
begin
  if new.role is distinct from 'athlete' then
    return new;
  end if;
  if not exists (select 1 from public.profiles where id = new.profile_id and quiet_hours_default_pending) then
    return new;
  end if;
  if exists (select 1 from public.group_memberships where profile_id = new.profile_id and role = 'coach')
     or exists (select 1 from public.organization_memberships where profile_id = new.profile_id) then
    update public.profiles set quiet_hours_default_pending = false where id = new.profile_id;
    return new;
  end if;
  select profile_id into v_coach from public.group_memberships where group_id = new.group_id and role = 'coach' order by joined_at nulls last limit 1;
  update public.profiles p
    set quiet_hours_start = case when p.quiet_hours_start is null and p.quiet_hours_end is null then 21 else p.quiet_hours_start end,
        quiet_hours_end = case when p.quiet_hours_start is null and p.quiet_hours_end is null then 7 else p.quiet_hours_end end,
        timezone = coalesce(nullif(btrim(p.timezone), ''), case when v_coach is not null then public.coach_time_zone(v_coach) end),
        quiet_hours_default_pending = false
    where p.id = new.profile_id and p.quiet_hours_default_pending;
  return new;
end;
$$;
revoke all on function public.default_new_client_quiet_hours() from public, anon, authenticated;

drop trigger if exists group_memberships_default_new_client_quiet_hours on public.group_memberships;
create trigger group_memberships_default_new_client_quiet_hours after insert on public.group_memberships
  for each row execute function public.default_new_client_quiet_hours();

-- C8: a private, read-only calendar link for Apple Calendar, Outlook or any calendar app (Ron, Nov 20). One per coach: a long random secret in the address; "Make a new link"
-- replaces it (the old address stops working at once) and "Turn off" removes it. Only the coach can read their own; the feed itself is read by the server with this secret
-- (app/api/calendar-feed/[token]). The feed lists the coach's sessions and calls with first names only, nothing else.
create table if not exists public.coach_calendar_feeds (
  coach_id uuid primary key references public.profiles(id) on delete cascade,
  token text not null unique check (token ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now()
);
alter table public.coach_calendar_feeds enable row level security;
revoke all on public.coach_calendar_feeds from anon, authenticated;
grant select on public.coach_calendar_feeds to authenticated;
drop policy if exists coach_calendar_feeds_select_own on public.coach_calendar_feeds;
create policy coach_calendar_feeds_select_own on public.coach_calendar_feeds for select to authenticated using (coach_id = (select auth.uid()));

-- A new secret for the signed-in coach (a coach of at least one group), replacing any old one. Returns the secret.
create or replace function public.new_calendar_feed_link()
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_token text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
begin
  if auth.uid() is null or not exists (select 1 from public.group_memberships where profile_id = auth.uid() and role = 'coach') then
    raise exception 'not authorized';
  end if;
  insert into public.coach_calendar_feeds (coach_id, token, created_at) values (auth.uid(), v_token, now())
  on conflict (coach_id) do update set token = excluded.token, created_at = excluded.created_at;
  return v_token;
end;
$$;
revoke all on function public.new_calendar_feed_link() from public, anon;
grant execute on function public.new_calendar_feed_link() to authenticated;

create or replace function public.turn_off_calendar_feed()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'not authorized';
  end if;
  delete from public.coach_calendar_feeds where coach_id = auth.uid();
end;
$$;
revoke all on function public.turn_off_calendar_feed() from public, anon;
grant execute on function public.turn_off_calendar_feed() to authenticated;

-- C7: paid booking on the public page (Ron, Nov 20). A coach can switch "Pay when booking" on for a public session type that has a price; off for every type until they do.
-- The visitor pays through the organization's own Stripe account (a direct charge, Spotlight's usual fee) BEFORE anything is booked:
--   * "Pay and book" makes a HOLD on that time for about half an hour (the public page treats it as taken), not a booking.
--   * A paid checkout claims its hold once and only then makes the client record, the booking and the private link. If the time was taken meanwhile, the payment is refunded.
--   * A payment that never happens leaves no booking and no client record: the hold lapses and the visitor's details on it are wiped.
--   * Refunds follow the cancel rules (lib/paid-booking.ts), each one recorded here with Stripe's refund id so it can never happen twice.
-- Only the server writes it (visitors have no account). The coach can read their own, for the "Paid online" line on the calendar; they are also told about each payment and refund.
alter table public.session_types add column if not exists pay_to_book boolean not null default false;

create table if not exists public.public_booking_holds (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid not null references public.profiles(id) on delete cascade,
  session_type_id uuid not null references public.session_types(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  start_at timestamptz not null,
  end_at timestamptz not null check (end_at > start_at),
  expires_at timestamptz not null,
  status_token_hash text not null unique,
  guest_name text,
  guest_email text,
  guest_phone text,
  note text,
  amount_cents integer not null check (amount_cents > 0),
  stripe_account_id text not null,
  checkout_session_id text unique,
  state text not null default 'open' check (state in ('open', 'claimed', 'booked', 'refunded', 'lapsed')),
  claimed_at timestamptz,
  booking_id uuid references public.bookings(id) on delete set null,
  manage_link_id uuid references public.booking_manage_links(id) on delete set null,
  group_id uuid references public.groups(id) on delete set null,
  athlete_id uuid references public.profiles(id) on delete set null,
  payment_intent_id text,
  refund_claimed_at timestamptz,
  refund_id text unique,
  refunded_at timestamptz,
  refund_reason text,
  created_at timestamptz not null default now()
);
create index if not exists public_booking_holds_coach_time on public.public_booking_holds (coach_id, start_at) where state in ('open', 'claimed');
create index if not exists public_booking_holds_booked on public.public_booking_holds (booking_id) where state = 'booked';
-- one open hold per visitor per coach: starting again replaces the old one (the route ends it first)
create unique index if not exists public_booking_holds_one_open on public.public_booking_holds (coach_id, lower(guest_email)) where state = 'open';
alter table public.public_booking_holds enable row level security;
revoke all on public.public_booking_holds from anon, authenticated;
grant select on public.public_booking_holds to authenticated;
drop policy if exists public_booking_holds_select_own on public.public_booking_holds;
create policy public_booking_holds_select_own on public.public_booking_holds for select to authenticated using (coach_id = (select auth.uid()));

-- C7: a session paid online is already paid. When a coach answers a late cancel or move of one with Charge, Charge keeps that payment and takes no session credit as well
-- (before, the visitor, who holds no sessions, would have gone to minus one). Waive refunds the payment (lib/paid-booking.ts). Patched into the LIVE function: the one line must
-- be found exactly once, or nothing changes. Already patched: skipped.
create or replace function pg_temp.patch_once_218(p_def text, p_old text, p_new text) returns text language plpgsql as $f$
declare
  v_count int := (length(p_def) - length(replace(p_def, p_old, ''))) / greatest(length(p_old), 1);
begin
  if v_count <> 1 then
    raise exception 'resolve_late_change: expected this exactly once, found % times. NOTHING was changed: %', v_count, left(p_old, 80);
  end if;
  return replace(p_def, p_old, p_new);
end;
$f$;

do $patch$
declare
  v_def text := replace(pg_get_functiondef('public.resolve_late_change(uuid, boolean)'::regprocedure), E'\r\n', E'\n');
begin
  if position('public_booking_holds' in v_def) > 0 then
    return;
  end if;
  v_def := pg_temp.patch_once_218(v_def,
    E'      v_take := greatest(0, 1 - public.booking_taken(p_booking_id));\n',
    E'      -- Wave 3 C7: paid online on the public page means already paid: Charge keeps that payment and takes no session.\n      v_take := case when exists (select 1 from public.public_booking_holds where booking_id = p_booking_id and state = ''booked'') then 0 else greatest(0, 1 - public.booking_taken(p_booking_id)) end;\n');
  execute v_def;
end
$patch$;

commit;

-- Check: one row, all true.
select
  exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'booking_requests' and column_name = 'lapse_told_at') as request_lapse_messages_ready,
  exists (select 1 from pg_trigger where tgname = 'group_memberships_default_new_client_quiet_hours' and not tgisinternal) as new_clients_get_quiet_hours,
  (select count(*) from public.profiles where quiet_hours_default_pending) = 0 as no_existing_account_changed,
  exists (select 1 from pg_class where oid = 'public.coach_calendar_feeds'::regclass and relrowsecurity) as calendar_links_private,
  not has_function_privilege('anon', 'public.new_calendar_feed_link()', 'execute') as signed_out_cannot_make_links,
  exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'session_types' and column_name = 'pay_to_book') as pay_when_booking_ready,
  (select count(*) from public.session_types where pay_to_book) = 0 as every_session_still_free,
  exists (select 1 from pg_class where oid = 'public.public_booking_holds'::regclass and relrowsecurity) as payments_private,
  not has_table_privilege('authenticated', 'public.public_booking_holds', 'insert') as only_the_server_records_payments,
  position('public_booking_holds' in (select prosrc from pg_proc where oid = 'public.resolve_late_change(uuid, boolean)'::regprocedure)) > 0 as charge_takes_no_session_when_paid_online;
