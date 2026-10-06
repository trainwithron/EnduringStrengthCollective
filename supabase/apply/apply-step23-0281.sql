-- STEP 23: 0281 inactive clients: a coach can set a client aside as inactive (reversible, nothing deleted, coach-only), and a workout, session or message from the client brings them back
--
-- Run apply-precheck first (every row ok = true). Then paste THIS file and run it once.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."
-- AFTERWARDS: Nothing visible changes at once. After the code deploy: under Needs your decision a client who has been quiet for about four months with a few other signs gets a neutral card (Send a door-open note, Set aside as inactive, Keep active, Not now), and a client profile gets a Set aside / Bring back control. A set-aside client is hidden from your dashboard and quiet-client alerts; their history, balance and messages stay. Only you (their coach or an org owner or admin) can see that someone is set aside, never the client or their teammates. Nothing is archived or sent automatically.
-- ON ERROR: it is all or nothing, so nothing was applied. Run   rollback;   once, copy the red error text, and send it back. Do not run the file again.
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

do $guard$
begin
  if not ((to_regclass('public.client_inactive') is null)) then
    raise exception 'Step 23 (0281) looks already applied, or the database is not in the state it expects. Nothing was changed. Run the precheck file and send Spot the result.';
  end if;
end
$guard$;

-- ====================================================================================================
-- migration 0281_inactive_clients.sql
-- ====================================================================================================

-- Quiet "inactive" status for clients who have effectively left (Ron, Oct 6). A coach can set a client aside without deleting anything: the client stays
-- a member with their history, balance and messages intact, but is hidden from dashboards, quiet-client alerts and counts. It is reversible, and a
-- new workout, session or message from the client brings them back by itself. Nothing is archived automatically; the app only suggests it.
--
--  * client_inactive(athlete, group, since, note): one row per client set aside. It is a SEPARATE coach-only table, not columns on group_memberships,
--    because every column on group_memberships is readable by the client and (in team groups) by every other member, and the status and the coach's
--    private reason must not be. Only the group's coach or an org owner or admin can read it; nobody writes it directly.
--  * set_client_inactive(athlete, group, inactive, note): the coach (or an org owner or admin) sets or clears it.
--  * resurface_inactive_client(): after a workout log, a booking, or a message FROM the client is added, the client is active again. Bookings the
--    server makes by itself (the nightly top-up of a weekly schedule) do not count: a client you set aside stays aside. A weekly schedule already
--    set up keeps running until it is ended separately.
--  * client_inactive_events: every set-aside and every bring-back (by the coach, or by the client's own activity) with its time. Nothing reads it today.
--    It exists so that, when plan limits are enforced, the number of clients can be the HIGH-WATER MARK of active clients during the billing period
--    (peak concurrent active, or distinct clients active at any moment) rather than a snapshot, so flipping clients off and on in rotation gains nothing.
--    A client brought back by their own activity counts as active from that moment. Plan limits are not enforced today.
-- Needs the group_memberships, workout_logs, bookings and direct_messages tables (0001, 0023, 0140) and is_group_coach / is_org_admin_of_group.
-- Re-running replaces the functions again.

create table if not exists public.client_inactive (
  athlete_id uuid not null references public.profiles(id) on delete cascade,
  group_id uuid not null references public.groups(id) on delete cascade,
  since timestamptz not null default now(),
  note text,
  set_by uuid references public.profiles(id) on delete set null,
  primary key (athlete_id, group_id)
);
create index if not exists client_inactive_group_idx on public.client_inactive (group_id);

alter table public.client_inactive enable row level security;
revoke all on public.client_inactive from public, anon, authenticated;
grant select on public.client_inactive to authenticated;
drop policy if exists "client_inactive_select_coach" on public.client_inactive;
create policy "client_inactive_select_coach" on public.client_inactive for select
  to authenticated
  using (public.is_group_coach(group_id) or public.is_org_admin_of_group(group_id));

create table if not exists public.client_inactive_events (
  id bigserial primary key,
  athlete_id uuid not null references public.profiles(id) on delete cascade,
  group_id uuid not null references public.groups(id) on delete cascade,
  at timestamptz not null default now(),
  event text not null check (event in ('set_aside', 'brought_back')),
  source text not null check (source in ('coach', 'client_activity')),
  by_profile uuid references public.profiles(id) on delete set null
);
create index if not exists client_inactive_events_group_idx on public.client_inactive_events (group_id, at);
alter table public.client_inactive_events enable row level security;
revoke all on public.client_inactive_events from public, anon, authenticated;
revoke all on sequence public.client_inactive_events_id_seq from public, anon, authenticated;
grant select on public.client_inactive_events to authenticated;
drop policy if exists "client_inactive_events_select_coach" on public.client_inactive_events;
create policy "client_inactive_events_select_coach" on public.client_inactive_events for select
  to authenticated
  using (public.is_group_coach(group_id) or public.is_org_admin_of_group(group_id));

create or replace function public.set_client_inactive(p_athlete_id uuid, p_group_id uuid, p_inactive boolean, p_note text default null)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if auth.uid() is null then
    raise exception 'not authorized';
  end if;
  if not (public.is_group_coach(p_group_id) or public.is_org_admin_of_group(p_group_id)) then
    raise exception 'not authorized';
  end if;
  if not exists (select 1 from public.group_memberships where group_id = p_group_id and profile_id = p_athlete_id and role = 'athlete') then
    raise exception 'that client is not in this group';
  end if;
  if p_inactive then
    if not exists (select 1 from public.client_inactive where athlete_id = p_athlete_id and group_id = p_group_id) then
      insert into public.client_inactive_events (athlete_id, group_id, event, source, by_profile) values (p_athlete_id, p_group_id, 'set_aside', 'coach', auth.uid());
    end if;
    insert into public.client_inactive (athlete_id, group_id, since, note, set_by)
    values (p_athlete_id, p_group_id, now(), nullif(btrim(coalesce(p_note, '')), ''), auth.uid())
    on conflict (athlete_id, group_id) do update set since = now(), note = excluded.note, set_by = excluded.set_by;
  else
    if exists (select 1 from public.client_inactive where athlete_id = p_athlete_id and group_id = p_group_id) then
      delete from public.client_inactive where athlete_id = p_athlete_id and group_id = p_group_id;
      insert into public.client_inactive_events (athlete_id, group_id, event, source, by_profile) values (p_athlete_id, p_group_id, 'brought_back', 'coach', auth.uid());
    end if;
  end if;
end;
$function$;

revoke all on function public.set_client_inactive(uuid, uuid, boolean, text) from public, anon;
grant execute on function public.set_client_inactive(uuid, uuid, boolean, text) to authenticated, service_role;

create or replace function public.resurface_inactive_client()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_athlete uuid;
  v_group uuid;
begin
  -- The server's own routines (the nightly top-up of a weekly schedule) are not the client coming back.
  if tg_table_name = 'bookings' and auth.role() = 'service_role' then
    return new;
  end if;
  if tg_table_name = 'direct_messages' then
    v_athlete := new.sender_id;
  else
    v_athlete := new.athlete_id;
  end if;
  v_group := new.group_id;
  if v_athlete is null then
    return new;
  end if;
  with gone as (delete from public.client_inactive where athlete_id = v_athlete and group_id = v_group returning 1)
  insert into public.client_inactive_events (athlete_id, group_id, event, source)
  select v_athlete, v_group, 'brought_back', 'client_activity' from gone;
  return new;
end;
$function$;

drop trigger if exists workout_logs_resurface_client on public.workout_logs;
create trigger workout_logs_resurface_client
  after insert on public.workout_logs
  for each row execute function public.resurface_inactive_client();

drop trigger if exists bookings_resurface_client on public.bookings;
create trigger bookings_resurface_client
  after insert on public.bookings
  for each row execute function public.resurface_inactive_client();

drop trigger if exists direct_messages_resurface_client on public.direct_messages;
create trigger direct_messages_resurface_client
  after insert on public.direct_messages
  for each row execute function public.resurface_inactive_client();

commit;
