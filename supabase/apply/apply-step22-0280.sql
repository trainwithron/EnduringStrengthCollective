-- STEP 22: 0280 credit expiry kept human: a coach can hold expiry for one client, give back sessions that expired (up to what expired, logged, undoable), and sets how early they are prompted
--
-- Run apply-precheck first (every row ok = true). Then paste THIS file and run it once.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."
-- AFTERWARDS: Nothing visible changes at once. After the code deploy: under Needs your decision a client whose sessions expire within 30 days gets a one-line check-in (Message them, Extend or pause expiry, Not now); a returning client whose sessions already expired gets a Reinstate prompt. Nothing is extended, reinstated or sent automatically. The nightly expiry job skips a client whose expiry you hold.
-- ON ERROR: it is all or nothing, so nothing was applied. Run   rollback;   once, copy the red error text, and send it back. Do not run the file again.
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

do $guard$
begin
  if not ((not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'session_credits' and column_name = 'expiry_hold_until'))) then
    raise exception 'Step 22 (0280) looks already applied, or the database is not in the state it expects. Nothing was changed. Run the precheck file and send Spot the result.';
  end if;
end
$guard$;

-- ====================================================================================================
-- migration 0280_credit_expiry_human_overrides.sql
-- ====================================================================================================

-- Credit expiry, kept human (Ron, Oct 6). Unused sessions still expire after the coach's own window (credit_expiry_days, counted from the LAST grant,
-- Ron's choice: the rule does not change), but a coach can now extend or pause expiry for one client, give back sessions that expired, and is
-- prompted BEFORE anything expires. Nothing is reinstated or extended automatically.
--
--  * session_credits.expiry_hold_until: while it is in the future the nightly expiry job skips this client's balance. A coach sets it (a number
--    of days past the expiry date, or a long pause) and can clear it. It is watched by the audit trail like the balance is.
--  * coach_booking_policies.expiry_heads_up_days (default 30): how many days before expiry the coach is prompted. Per coach.
--  * session_credit_reinstatements: one row per give-back (amount, and how much of it was later taken back). Reinstatement accounting reads this
--    table, never ledger notes. No policies: only the functions below read or write it.
--  * set_credit_expiry_hold(athlete, group, until, note): the coach's hold, logged in the session ledger (kind 'adjusted', amount 0) with the note.
--  * reinstate_expired_credits(athlete, group, amount, note): gives back up to what expired and has not been given back yet. The coach chooses the
--    amount; it goes through the one internal credit function (so the expiry clock restarts for the client's WHOLE balance, not only the sessions
--    given back), and is logged with the note. Anyone who coaches the group (or an org owner or admin) can do it.
--  * undo_expired_reinstatement(athlete, group, amount): takes back sessions that were reinstated, but ONLY while nothing has happened to the client's
--    sessions since the give-back (no session used, bought, assigned, refunded or charged), so it can never take back sessions bought afterwards.
--  * reinstatable_expired_credits(athlete, group): what expired and was not given back. Only the group's coach, an org owner or admin, the client
--    themselves, or the server can read it.
-- The client's balance, the ledger and the expiry job all keep working exactly as before for every client without a hold.
-- Needs 0209 (credit expiry), 0246 and 0248 (the ledger and the internal credit function), 0267 (the audit trail). Re-running replaces the functions again.

alter table public.session_credits
  add column if not exists expiry_hold_until timestamptz;

alter table public.coach_booking_policies
  add column if not exists expiry_heads_up_days int not null default 30 check (expiry_heads_up_days >= 0 and expiry_heads_up_days <= 365);

create table if not exists public.session_credit_reinstatements (
  id uuid primary key default uuid_generate_v4(),
  athlete_id uuid not null references public.profiles(id) on delete cascade,
  group_id uuid not null references public.groups(id) on delete cascade,
  amount int not null check (amount > 0),
  -- How many of these sessions were later taken back (never more than amount).
  undone_amount int not null default 0 check (undone_amount >= 0 and undone_amount <= amount),
  created_at timestamptz not null default clock_timestamp(),
  last_undone_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null
);
create index if not exists session_credit_reinstatements_client_idx on public.session_credit_reinstatements (athlete_id, group_id);
alter table public.session_credit_reinstatements enable row level security;
revoke all on public.session_credit_reinstatements from public, anon, authenticated;

-- A hold change is a money-adjacent edit: the audit trail records it like it records the balance.
drop trigger if exists session_credits_audit on public.session_credits;
create trigger session_credits_audit after insert or update on public.session_credits
  for each row execute function public.audit_watch('balance,payment_hold,expiry_hold_until', 'insert_too', 'athlete_id,group_id');

-- What has expired and not yet been given back, for one client in one group.
create or replace function public.reinstatable_expired_credits(p_athlete_id uuid, p_group_id uuid)
returns integer
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
begin
  if auth.uid() is not null
     and auth.uid() <> p_athlete_id
     and not (public.is_group_coach(p_group_id) or public.is_org_admin_of_group(p_group_id)) then
    raise exception 'not authorized';
  end if;
  return greatest(0,
    coalesce((select sum(-l.amount) from public.session_credit_ledger l where l.athlete_id = p_athlete_id and l.group_id = p_group_id and l.kind = 'expired'), 0)
    - coalesce((select sum(r.amount - r.undone_amount) from public.session_credit_reinstatements r where r.athlete_id = p_athlete_id and r.group_id = p_group_id), 0)
  )::integer;
end;
$function$;

revoke all on function public.reinstatable_expired_credits(uuid, uuid) from public, anon;
grant execute on function public.reinstatable_expired_credits(uuid, uuid) to authenticated, service_role;

create or replace function public.set_credit_expiry_hold(p_athlete_id uuid, p_group_id uuid, p_until timestamp with time zone, p_note text default null)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_balance int;
  v_what text;
begin
  if auth.uid() is null then
    raise exception 'not authorized';
  end if;
  if not (public.is_group_coach(p_group_id) or public.is_org_admin_of_group(p_group_id)) then
    raise exception 'not authorized';
  end if;
  if p_until is not null and (p_until <= now() or p_until > now() + interval '5 years') then
    raise exception 'the hold must end between now and five years from now';
  end if;

  select balance into v_balance from public.session_credits where athlete_id = p_athlete_id and group_id = p_group_id for update;
  if not found then
    raise exception 'this client has no session balance';
  end if;

  update public.session_credits set expiry_hold_until = p_until, updated_at = now() where athlete_id = p_athlete_id and group_id = p_group_id;

  v_what := case when p_until is null then 'Expiry hold removed' else 'Expiry held until ' || to_char(p_until, 'Mon FMDD, YYYY') end;
  insert into public.session_credit_ledger (athlete_id, group_id, kind, amount, balance_after, note, created_by)
  values (p_athlete_id, p_group_id, 'adjusted', 0, v_balance, v_what || coalesce(': ' || nullif(btrim(p_note), ''), ''), auth.uid());
end;
$function$;

create or replace function public.reinstate_expired_credits(p_athlete_id uuid, p_group_id uuid, p_amount integer, p_note text default null)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_available int;
  v_new_balance int;
begin
  if auth.uid() is null then
    raise exception 'not authorized';
  end if;
  if not (public.is_group_coach(p_group_id) or public.is_org_admin_of_group(p_group_id)) then
    raise exception 'not authorized';
  end if;
  if p_amount is null or p_amount < 1 then
    raise exception 'choose at least one session';
  end if;
  -- Serialise two answers for the same client so the same expired sessions cannot be given back twice.
  perform 1 from public.session_credits where athlete_id = p_athlete_id and group_id = p_group_id for update;
  v_available := public.reinstatable_expired_credits(p_athlete_id, p_group_id);
  if p_amount > v_available then
    raise exception 'only % expired sessions can be given back', v_available;
  end if;
  v_new_balance := public.apply_session_credit_change(
    p_athlete_id, p_group_id, p_amount, 'adjusted',
    'Reinstated expired sessions' || coalesce(': ' || nullif(btrim(p_note), ''), ''),
    null, auth.uid()
  );
  insert into public.session_credit_reinstatements (athlete_id, group_id, amount, created_by)
  values (p_athlete_id, p_group_id, p_amount, auth.uid());
  return v_new_balance;
end;
$function$;

create or replace function public.undo_expired_reinstatement(p_athlete_id uuid, p_group_id uuid, p_amount integer)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_outstanding int;
  v_balance int;
  v_since timestamptz;
  v_left int;
  v_row record;
  v_take int;
begin
  if auth.uid() is null then
    raise exception 'not authorized';
  end if;
  if not (public.is_group_coach(p_group_id) or public.is_org_admin_of_group(p_group_id)) then
    raise exception 'not authorized';
  end if;
  if p_amount is null or p_amount < 1 then
    raise exception 'choose at least one session';
  end if;
  select balance into v_balance from public.session_credits where athlete_id = p_athlete_id and group_id = p_group_id for update;
  if not found then
    raise exception 'this client has no session balance';
  end if;
  select coalesce(sum(amount - undone_amount), 0), max(greatest(created_at, coalesce(last_undone_at, created_at)))
    into v_outstanding, v_since
    from public.session_credit_reinstatements where athlete_id = p_athlete_id and group_id = p_group_id;
  if p_amount > v_outstanding then
    raise exception 'only % reinstated sessions can be taken back', v_outstanding;
  end if;
  if p_amount > v_balance then
    raise exception 'the client has already used some of those sessions';
  end if;
  -- Only while nothing has happened to the client's sessions since the give-back (or since the last take-back): a session used, bought, assigned,
  -- refunded or charged since then means this could take back other sessions than the ones that were given back.
  if exists (
    select 1 from public.session_credit_ledger l
    where l.athlete_id = p_athlete_id and l.group_id = p_group_id and l.amount <> 0 and l.created_at > v_since
  ) then
    raise exception 'the client''s sessions have changed since they were given back, so this can no longer be undone here; adjust the balance by hand instead';
  end if;

  -- Take the sessions back from the newest give-backs first.
  v_left := p_amount;
  for v_row in
    select id, amount - undone_amount as open_amount from public.session_credit_reinstatements
    where athlete_id = p_athlete_id and group_id = p_group_id and amount - undone_amount > 0
    order by created_at desc
  loop
    exit when v_left <= 0;
    v_take := least(v_left, v_row.open_amount);
    update public.session_credit_reinstatements set undone_amount = undone_amount + v_take, last_undone_at = clock_timestamp() where id = v_row.id;
    v_left := v_left - v_take;
  end loop;
  return public.apply_session_credit_change(p_athlete_id, p_group_id, -p_amount, 'adjusted', 'Reinstatement undone', null, auth.uid());
end;
$function$;

revoke all on function public.set_credit_expiry_hold(uuid, uuid, timestamptz, text) from public, anon;
grant execute on function public.set_credit_expiry_hold(uuid, uuid, timestamptz, text) to authenticated, service_role;
revoke all on function public.reinstate_expired_credits(uuid, uuid, integer, text) from public, anon;
grant execute on function public.reinstate_expired_credits(uuid, uuid, integer, text) to authenticated, service_role;
revoke all on function public.undo_expired_reinstatement(uuid, uuid, integer) from public, anon;
grant execute on function public.undo_expired_reinstatement(uuid, uuid, integer) to authenticated, service_role;

commit;
