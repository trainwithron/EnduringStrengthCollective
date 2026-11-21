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
