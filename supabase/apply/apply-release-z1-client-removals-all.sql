-- RELEASE Z1 (REMOVE A CLIENT WITHOUT DESTROYING THEM, AND A 30-DAY UNDO FOR A PERMANENT DELETE; ADDS ONLY, SAFE BEFORE THE CODE): ONE paste. Steps 159 in order, all or nothing.
--
-- Paste this whole file into the Supabase SQL editor and run it once. It replaces the separate precheck and apply files for these steps (they stay as the fallback).
-- Every check from each step's precheck is built in as a guard in front of that step. If any check is false, the run stops with a message that names the step and the
-- failed check, and NOTHING is kept, so a second run after a refusal is safe.
-- WHAT YOU SHOULD SEE: first "Success" for the transaction, then a result table with one row per step and in_place = true on every row.
-- ON ERROR: run   rollback;   once, copy the red text, send it to Spot. Do not run it again.
-- AFTER STEP 159: Nothing changes on screen until the Release Z1 code is live. Adds two tables (client_removals: who was taken out of which group, with their name, email, membership and rate as they were; client_removal_log: a person-free note of each permanent erase) and two functions (remove_client, restore_removed_client), plus a small trigger that un-hides a one-on-one space when a client joins it again. Safe to run before the code.
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

-- ===== Release Z1 (remove a client without destroying them, and a 30-day undo for a permanent delete; adds only, safe before the code), step 159: 0407 Release Z1: take a client out of a group without destroying them (Remove from my clients, Delete permanently with 30 days to undo)
do $g159$
declare
  failed text;
begin
  select string_agg(check_name, '; ') into failed from (
    values
      ('0407 is not already applied (the removals table is not there yet)', to_regclass('public.client_removals') is null),
      ('the tables and helpers it uses exist', to_regclass('public.group_memberships') is not null and to_regclass('public.profiles') is not null and to_regclass('public.client_billing_rates') is not null and to_regclass('public.membership_subscriptions') is not null and to_regclass('public.recurring_booking_series') is not null and to_regclass('public.booking_waitlist_entries') is not null and to_regprocedure('public.is_group_coach(uuid)') is not null and to_regprocedure('public.cancel_booking_and_refund_credit(uuid)') is not null and to_regprocedure('public.cancel_recurring_booking_series(uuid)') is not null and to_regprocedure('public.audit_record(text, text, text, jsonb)') is not null)
  ) as checks(check_name, ok) where not ok;
  if failed is not null then
    raise exception 'Release Z1 (remove a client without destroying them, and a 30-day undo for a permanent delete; adds only, safe before the code), step 159 (0407) cannot run: this step looks already applied, or the database is not in the state it expects. Failed checks: %. NOTHING was changed (the whole bundle is all or nothing). If an earlier step was applied by hand, use the single-step files for the rest, and send Spot this message.', failed;
  end if;
end
$g159$;

-- ====================================================================================================
-- migration 0407_client_removals.sql
-- ====================================================================================================

-- Release Z1: taking a client out of a group without destroying them, and a 30-day undo for a permanent delete.
--
-- Until now the only way a coach could get rid of a client was to erase the whole account. Now:
--   Remove from my clients   the person's membership in this group is taken away (they stop appearing in lists and counts, and lose the group), but their account, their data and everything filed under the group stay,
--                            linked to their email. A record of the membership (and of the rate the coach set for them) is kept so the coach can put them back exactly as they were. There is no time limit.
--                            Their upcoming sessions with this coach are cancelled and the credits come back to them (the coach cancelling always refunds); a repeating booking is ended. A one-on-one space left with no client is archived,
--                            so it leaves the coach's switcher and Home (the coach can still open it, and putting the client back brings it back).
--                            Refused while the client has a live subscription in this group (cancel it first, so nobody is billed after leaving).
--   Delete permanently       the same removal, plus a date 30 days away. Until that date the coach can undo it; on that date a scheduled job erases the account as the delete always did (unless they belong to other
--                            groups or have another coach's removal open, in which case only the removal stands and the account is kept).
-- client_removals holds those records (name and email as they were, the membership as it was). A coach reads the records of their own groups; nothing is written to it from a browser.
-- client_removal_log keeps a short, person-free note of every permanent erase after the account (and so the record above) is gone. Additions only. Re-runnable.
create table if not exists public.client_removals (
  id uuid primary key default gen_random_uuid(),
  group_id uuid references public.groups(id) on delete set null,
  athlete_id uuid not null references public.profiles(id) on delete cascade,
  athlete_name text,
  athlete_email text,
  membership jsonb not null,
  billing_rate jsonb,
  cancelled_bookings int not null default 0,
  archived_space boolean not null default false,
  removed_by uuid references public.profiles(id) on delete set null,
  removed_at timestamptz not null default now(),
  restored_at timestamptz,
  delete_after timestamptz,
  erase_history boolean not null default false,
  erasing_since timestamptz,
  purged_at timestamptz,
  purge_note text
);
alter table public.client_removals add column if not exists billing_rate jsonb;
alter table public.client_removals add column if not exists cancelled_bookings int not null default 0;
alter table public.client_removals add column if not exists archived_space boolean not null default false;
alter table public.client_removals add column if not exists erasing_since timestamptz;
create unique index if not exists client_removals_one_open on public.client_removals (group_id, athlete_id) where restored_at is null and purged_at is null;
create index if not exists client_removals_due_idx on public.client_removals (delete_after) where restored_at is null and purged_at is null and delete_after is not null;
create index if not exists client_removals_athlete_idx on public.client_removals (athlete_id) where restored_at is null and purged_at is null;
alter table public.client_removals enable row level security;
revoke all on public.client_removals from anon, authenticated;
grant select on public.client_removals to authenticated;
drop policy if exists "client_removals_select_coach" on public.client_removals;
create policy "client_removals_select_coach" on public.client_removals for select to authenticated using (group_id is not null and public.is_group_coach(group_id));

-- What happened to each permanent delete, kept after the person is gone. Holds no name and no email. Written by the scheduled job only.
create table if not exists public.client_removal_log (
  id uuid primary key default gen_random_uuid(),
  removal_id uuid not null,
  group_id uuid,
  outcome text not null,
  note text,
  created_at timestamptz not null default now()
);
-- one row per removal: a retried erase updates it rather than adding another
create unique index if not exists client_removal_log_one_per_removal on public.client_removal_log (removal_id);
alter table public.client_removal_log enable row level security;
revoke all on public.client_removal_log from anon, authenticated;

-- Take a client out of the group. The caller must coach the group; the person must be a client of it; a coach cannot remove themselves or another coach.
create or replace function public.remove_client(p_group uuid, p_athlete uuid, p_permanent boolean default false, p_erase_history boolean default false)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  m public.group_memberships%rowtype;
  v_name text;
  v_email text;
  v_id uuid;
  v_rate jsonb;
  v_cancelled int := 0;
  v_kind text;
  v_archived boolean := false;
  v_prev_archived boolean := false;
  v_name_me text;
  b record;
begin
  if me is null or not public.is_group_coach(p_group) then
    raise exception 'Only a coach of this group can remove a client.';
  end if;
  if p_athlete = me then
    raise exception 'You can''t remove yourself here.';
  end if;
  select * into m from public.group_memberships where group_id = p_group and profile_id = p_athlete and role = 'athlete' for update;
  if not found then
    raise exception 'That person isn''t a client in this group.';
  end if;
  if exists (select 1 from public.membership_subscriptions s where s.athlete_id = p_athlete and s.group_id = p_group and s.status <> 'canceled') then
    raise exception 'They have a live subscription. Cancel it first so they are not billed after they leave.';
  end if;

  -- A record left open from an earlier removal (they were invited back in) is out of date: close it so there is only ever one.
  -- (If that record had archived the space, the new one carries it forward so Put back still brings the space back.)
  select coalesce(bool_or(archived_space), false) into v_prev_archived from public.client_removals where group_id = p_group and athlete_id = p_athlete and restored_at is null and purged_at is null;
  update public.client_removals
    set restored_at = now(), delete_after = null, erasing_since = null, purge_note = 'Closed: they became a client of this group again.'
    where group_id = p_group and athlete_id = p_athlete and restored_at is null and purged_at is null;

  select full_name into v_name from public.profiles where id = p_athlete;
  select lower(email) into v_email from auth.users where id = p_athlete;
  select to_jsonb(r) into v_rate from public.client_billing_rates r where r.membership_id = m.id;

  -- Their upcoming sessions with this group's coaches end here. Each goes through the same cancel the app uses (a coach cancelling always gives the credit back and offers the slot to the waitlist).
  for b in select id from public.recurring_booking_series where athlete_id = p_athlete and group_id = p_group and status in ('active', 'paused') loop
    v_cancelled := v_cancelled + coalesce(public.cancel_recurring_booking_series(b.id), 0);
  end loop;
  for b in select id from public.bookings where athlete_id = p_athlete and group_id = p_group and status = 'confirmed' and start_at > now() order by start_at loop
    -- the hidden booking that holds the time of a scheduled group session is not an ordinary booking and cannot be cancelled here
    if exists (select 1 from public.group_sessions gs where gs.anchor_booking_id = b.id and gs.status = 'scheduled') then
      raise exception 'Change the group session first. This client holds the time of a scheduled group session.';
    end if;
    perform public.cancel_booking_and_refund_credit(b.id);
    v_cancelled := v_cancelled + 1;
  end loop;
  update public.booking_waitlist_entries set status = 'cancelled' where athlete_id = p_athlete and group_id = p_group and status in ('waiting', 'offered');
  -- A seat (or a place on the waitlist) in an upcoming group class or event of this group is given up the way the app's own leave does it: the credit comes back and the next person on the waitlist is offered the seat.
  for b in
    select a.group_session_id as id, coalesce(gs.kind, 'class') as kind from public.group_session_attendees a
    join public.group_sessions gs on gs.id = a.group_session_id
    where a.athlete_id = p_athlete and a.group_id = p_group and a.status in ('joined', 'waitlisted') and gs.status = 'scheduled' and gs.start_at > now()
    order by gs.start_at
  loop
    if b.kind = 'event' then
      update public.group_session_attendees set status = 'cancelled', credit_taken = false, updated_at = now() where group_session_id = b.id and athlete_id = p_athlete;
    else
      perform public.leave_group_session(b.id, p_athlete);
    end if;
    v_cancelled := v_cancelled + 1;
  end loop;

  insert into public.client_removals (group_id, athlete_id, athlete_name, athlete_email, membership, billing_rate, cancelled_bookings, removed_by, delete_after, erase_history)
  values (p_group, p_athlete, v_name, v_email, to_jsonb(m), v_rate, v_cancelled, me, case when p_permanent then now() + interval '30 days' else null end, p_permanent and p_erase_history)
  returning id into v_id;
  delete from public.group_memberships where id = m.id;

  -- A one-on-one space with no client left leaves the coach's switcher and Home (the same "archived" a retired team uses).
  select group_kind into v_kind from public.groups where id = p_group;
  if v_kind = 'one_on_one'
     and not exists (select 1 from public.group_memberships where group_id = p_group and role = 'athlete')
     and exists (select 1 from public.groups where id = p_group and archived_at is null) then
    update public.groups set archived_at = now() where id = p_group;
    update public.client_removals set archived_space = true where id = v_id;
    v_archived := true;
  elsif v_kind = 'one_on_one' and v_prev_archived and not exists (select 1 from public.group_memberships where group_id = p_group and role = 'athlete') then
    update public.client_removals set archived_space = true where id = v_id;
    v_archived := true;
  end if;

  -- The client is told, in the bell, that their upcoming sessions were cancelled and the credits are back (an existing kind of notice).
  if v_cancelled > 0 then
    select nullif(btrim(full_name), '') into v_name_me from public.profiles where id = me;
    insert into public.notifications (profile_id, group_id, type, body, link_path)
    values (p_athlete, p_group, 'schedule_applied', coalesce(v_name_me, 'Your coach') || ' cancelled ' || v_cancelled::text || ' of your upcoming session' || case when v_cancelled = 1 then '' else 's' end || '. The credits were returned to you.', '/');
  end if;

  perform public.audit_record('group_memberships', m.id::text, 'update', jsonb_build_object('event', case when p_permanent then 'client_deleted_30_day_undo' else 'client_removed' end, 'group', p_group, 'client', p_athlete, 'by', me, 'removal', v_id, 'cancelled_bookings', v_cancelled, 'space_archived', v_archived));
  return v_id;
end;
$$;
revoke execute on function public.remove_client(uuid, uuid, boolean, boolean) from public, anon;
grant execute on function public.remove_client(uuid, uuid, boolean, boolean) to authenticated, service_role;

-- Put a removed client back exactly as they were (their position, tier, privacy setting, rate and the rest), and cancel a scheduled delete. The caller must coach the group.
-- Only the columns the record holds are put back, so a column added since comes back with its own default. If it can't be done the reason is said in plain words and nothing changes.
create or replace function public.restore_removed_client(p_removal uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  r public.client_removals%rowtype;
  s jsonb;
  cols text;
  v_new uuid;
begin
  select * into r from public.client_removals where id = p_removal for update;
  if not found or me is null or r.group_id is null or not public.is_group_coach(r.group_id) then
    raise exception 'That removal was not found.';
  end if;
  if r.restored_at is not null or r.purged_at is not null then
    raise exception 'That client has already been put back or deleted.';
  end if;
  if r.erasing_since is not null then
    raise exception 'This client is being deleted right now, so they can''t be put back.';
  end if;
  if not exists (select 1 from public.group_memberships where group_id = r.group_id and profile_id = r.athlete_id) then
    s := r.membership - 'id';
    -- A position deleted since is dropped rather than refusing the whole thing.
    if s ->> 'position_id' is not null and not exists (select 1 from public.group_positions where id = (s ->> 'position_id')::uuid) then
      s := s - 'position_id';
    end if;
    select string_agg(quote_ident(k.key), ', ') into cols
      from jsonb_object_keys(s) as k(key)
      join information_schema.columns c on c.table_schema = 'public' and c.table_name = 'group_memberships' and c.column_name = k.key;
    begin
      execute format('insert into public.group_memberships (%1$s) select %1$s from jsonb_populate_record(null::public.group_memberships, $1) returning id', cols) using s into v_new;
    exception
      when raise_exception then
        raise exception 'They can''t be put back right now: %', sqlerrm;
      when others then
        raise exception 'They can''t be put back right now. Nothing was changed.';
    end;
    if r.billing_rate is not null then
      insert into public.client_billing_rates (membership_id, group_id, profile_id, monthly_rate, updated_at)
      values (v_new, r.group_id, r.athlete_id, (r.billing_rate ->> 'monthly_rate')::numeric, coalesce((r.billing_rate ->> 'updated_at')::timestamptz, now()))
      on conflict (membership_id) do nothing;
    end if;
  end if;
  if r.archived_space then
    update public.groups set archived_at = null where id = r.group_id;
  end if;
  update public.client_removals set restored_at = now(), delete_after = null where id = r.id;
  perform public.audit_record('group_memberships', r.athlete_id::text, 'insert', jsonb_build_object('event', 'client_restored', 'group', r.group_id, 'client', r.athlete_id, 'by', me, 'removal', r.id));
  return r.athlete_id;
end;
$$;
revoke execute on function public.restore_removed_client(uuid) from public, anon;
grant execute on function public.restore_removed_client(uuid) to authenticated, service_role;

-- A one-on-one space that was archived because its only client left comes back the moment a client joins it again (re-invited, added, or put back), so it is never left hidden with a client in it.
create or replace function public.unarchive_one_on_one_on_client_join()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.role = 'athlete' then
    update public.groups set archived_at = null where id = new.group_id and group_kind = 'one_on_one' and archived_at is not null;
  end if;
  return new;
end;
$$;
revoke execute on function public.unarchive_one_on_one_on_client_join() from public, anon, authenticated;
drop trigger if exists group_memberships_unarchive_one_on_one on public.group_memberships;
create trigger group_memberships_unarchive_one_on_one
  after insert on public.group_memberships
  for each row execute function public.unarchive_one_on_one_on_client_join();

commit;

-- Read-only result (after the commit): every row must say in_place = true.
select step, what, in_place from (
  select 'step 159 (0407)' as step, '0407 Release Z1: take a client out of a group without destroying them' as what, not ((to_regclass('public.client_removals') is null)) as in_place
) as result order by step;
