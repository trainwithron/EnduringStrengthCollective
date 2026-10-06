-- STEP 23: 0281 inactive clients: a coach can set a client aside as inactive (reversible, nothing deleted), and a workout, session or message from the client brings them back
--
-- Run apply-precheck first (every row ok = true). Then paste THIS file and run it once.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."
-- AFTERWARDS: Nothing visible changes at once. After the code deploy: under Needs your decision a client who has been quiet for about four months with a few other signs gets a neutral card (Send a door-open note, Set aside as inactive, Keep active, Not now), and a client profile gets a Set aside / Bring back control. A set-aside client is hidden from your dashboard and quiet-client alerts; their history, balance and messages stay. Nothing is archived or sent automatically.
-- ON ERROR: it is all or nothing, so nothing was applied. Run   rollback;   once, copy the red error text, and send it back. Do not run the file again.
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

do $guard$
begin
  if not ((not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'group_memberships' and column_name = 'inactive_at'))) then
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
--  * group_memberships.inactive_at / inactive_note: null means active (every existing client).
--  * set_client_inactive(athlete, group, inactive, note): the coach (or an org owner or admin) sets or clears it.
--  * resurface_inactive_client(): after a workout log, a booking, or a message FROM the client is added, the client is active again.
-- Needs the group_memberships, workout_logs, bookings and direct_messages tables (0001, 0023, 0140). Re-running replaces the functions again.

alter table public.group_memberships
  add column if not exists inactive_at timestamptz,
  add column if not exists inactive_note text;

create index if not exists group_memberships_inactive_idx on public.group_memberships (group_id) where inactive_at is not null;

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
  update public.group_memberships
    set inactive_at = case when p_inactive then now() else null end,
        inactive_note = case when p_inactive then nullif(btrim(coalesce(p_note, '')), '') else null end
    where group_id = p_group_id and profile_id = p_athlete_id and role = 'athlete';
  if not found then
    raise exception 'that client is not in this group';
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
  if tg_table_name = 'direct_messages' then
    v_athlete := new.sender_id;
    v_group := new.group_id;
  else
    v_athlete := new.athlete_id;
    v_group := new.group_id;
  end if;
  update public.group_memberships
    set inactive_at = null, inactive_note = null
    where group_id = v_group and profile_id = v_athlete and role = 'athlete' and inactive_at is not null;
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
