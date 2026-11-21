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
