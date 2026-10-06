-- STEP 23 PROBE (run BEFORE step 23, changes NOTHING). Paste the whole file and run it once.
-- It applies 0281 inside a transaction, tries four cases on one client of the Test Sandbox group (never a real client), then ends with an intentional red error that holds the result and
-- rolls everything back (the table, the triggers and the test rows are all undone).
-- WHAT YOU SHOULD SEE: a red error whose text starts "PROBE RESULT" and says  server booking was made and left them set aside: true | client message brought them back: true | coach message left them set aside: true | ordinary booking brought them back: true
-- That error is the expected answer, not a failure. If any value is false, or the error says anything else, copy it and send it to Spot. Then run   rollback;   once.
-- Safe to run twice. It never writes anything that survives.
begin;
-- If this transaction is ever left open after the intentional error, these make the server end it by itself and keep it from waiting on locks, so it can never hold up bookings, workout logs or messages.
set local lock_timeout = '3s';
set local statement_timeout = '30s';
set local idle_in_transaction_session_timeout = '30s';

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

do $probe$
declare
  v_athlete uuid;
  v_group uuid;
  v_coach uuid;
  a boolean;
  b boolean;
  c boolean;
  d boolean;
  v_err text := '';
  v_ins boolean := false;
begin
  select gm.profile_id, gm.group_id, cg.profile_id into v_athlete, v_group, v_coach
  from public.group_memberships gm
  join public.group_memberships cg on cg.group_id = gm.group_id and cg.role = 'coach' and cg.profile_id <> gm.profile_id
  where gm.role = 'athlete'
    and gm.group_id = '50000000-0000-0000-0000-000000000002'
  order by gm.joined_at nulls last
  limit 1;
  if v_athlete is null then
    raise exception 'PROBE RESULT: no athlete and coach in the Test Sandbox group to test with, nothing was proven';
  end if;

  -- A: a booking made by the server (service role) leaves a set-aside client set aside.
  insert into public.client_inactive (athlete_id, group_id, note) values (v_athlete, v_group, 'probe');
  begin
    execute 'set local role service_role';
    perform set_config('request.jwt.claim.role', 'service_role', true);
    perform set_config('request.jwt.claim.sub', '', true);
    perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
    insert into public.bookings (coach_id, athlete_id, group_id, start_at, end_at, status, credit_state)
    values (v_coach, v_athlete, v_group, now() + interval '400 days 3 minutes', now() + interval '400 days 63 minutes', 'confirmed', 'unsettled');
    v_ins := true;
    execute 'reset role';
  exception when others then
    execute 'reset role';
    v_err := v_err || ' [server booking error: ' || sqlerrm || ']';
  end;
  perform set_config('request.jwt.claim.role', '', true);
  perform set_config('request.jwt.claims', '', true);
  a := v_ins and exists (select 1 from public.client_inactive where athlete_id = v_athlete and group_id = v_group);

  -- C: a message the coach sends leaves them set aside (still set from A).
  insert into public.direct_messages (group_id, sender_id, recipient_id, body) values (v_group, v_coach, v_athlete, 'probe');
  c := exists (select 1 from public.client_inactive where athlete_id = v_athlete and group_id = v_group);

  -- B: a message from the client brings them back.
  insert into public.direct_messages (group_id, sender_id, recipient_id, body) values (v_group, v_athlete, v_coach, 'probe');
  b := not exists (select 1 from public.client_inactive where athlete_id = v_athlete and group_id = v_group);

  -- D: an ordinary booking (not made by the server) brings them back.
  insert into public.client_inactive (athlete_id, group_id, note) values (v_athlete, v_group, 'probe');
  begin
    insert into public.bookings (coach_id, athlete_id, group_id, start_at, end_at, status, credit_state)
    values (v_coach, v_athlete, v_group, now() + interval '401 days 3 minutes', now() + interval '401 days 63 minutes', 'confirmed', 'unsettled');
  exception when others then
    v_err := v_err || ' [ordinary booking error: ' || sqlerrm || ']';
  end;
  d := not exists (select 1 from public.client_inactive where athlete_id = v_athlete and group_id = v_group);

  raise exception 'PROBE RESULT (rolled back, nothing kept) | server booking was made and left them set aside: % | client message brought them back: % | coach message left them set aside: % | ordinary booking brought them back: % %', a::text, b::text, c::text, d::text, v_err;
end
$probe$;

rollback;
