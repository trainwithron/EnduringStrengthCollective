-- Credit expiry, kept human (Ron, Oct 6). Unused sessions still expire after the coach's own window (credit_expiry_days), but a coach can now
-- extend or pause expiry for one client, give back sessions that expired, and is prompted BEFORE anything expires. Nothing is reinstated or
-- extended automatically.
--
--  * session_credits.expiry_hold_until: while it is in the future the nightly expiry job skips this client's balance. A coach sets it (a number
--    of days past the expiry date, or a long pause) and can clear it.
--  * coach_booking_policies.expiry_heads_up_days (default 30): how many days before expiry the coach is prompted. Per coach.
--  * set_credit_expiry_hold(athlete, group, until, note): the coach's hold, logged in the session ledger (kind 'adjusted', amount 0) with the note.
--  * reinstate_expired_credits(athlete, group, amount, note): gives back up to what expired and has not been given back yet. The coach chooses the
--    amount; it goes through the one internal credit function (so the clock restarts), and is logged with the note.
--  * undo_expired_reinstatement(athlete, group, amount): takes back sessions that were reinstated (up to what is still reinstated and still on the
--    balance), logged.
-- The client's balance, the ledger and the expiry job all keep working exactly as before for every client without a hold.
-- Needs 0209 (credit expiry), 0246 and 0248 (the ledger and the internal credit function). Re-running replaces the functions again.

alter table public.session_credits
  add column if not exists expiry_hold_until timestamptz;

alter table public.coach_booking_policies
  add column if not exists expiry_heads_up_days int not null default 30 check (expiry_heads_up_days >= 0 and expiry_heads_up_days <= 365);

-- What has expired and not yet been given back, for one client in one group.
create or replace function public.reinstatable_expired_credits(p_athlete_id uuid, p_group_id uuid)
returns integer
language sql
stable
security definer
set search_path to 'public'
as $function$
  select greatest(0,
    coalesce((select sum(-l.amount) from public.session_credit_ledger l where l.athlete_id = p_athlete_id and l.group_id = p_group_id and l.kind = 'expired'), 0)
    - coalesce((select sum(l.amount) from public.session_credit_ledger l where l.athlete_id = p_athlete_id and l.group_id = p_group_id and l.kind = 'adjusted' and l.note like 'Reinstated expired sessions%'), 0)
    + coalesce((select sum(-l.amount) from public.session_credit_ledger l where l.athlete_id = p_athlete_id and l.group_id = p_group_id and l.kind = 'adjusted' and l.note like 'Reinstatement undone%'), 0)
  )::integer;
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
  v_reinstated int;
  v_balance int;
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
  v_reinstated := greatest(0,
    coalesce((select sum(l.amount) from public.session_credit_ledger l where l.athlete_id = p_athlete_id and l.group_id = p_group_id and l.kind = 'adjusted' and l.note like 'Reinstated expired sessions%'), 0)
    + coalesce((select sum(l.amount) from public.session_credit_ledger l where l.athlete_id = p_athlete_id and l.group_id = p_group_id and l.kind = 'adjusted' and l.note like 'Reinstatement undone%'), 0)
  );
  if p_amount > v_reinstated then
    raise exception 'only % reinstated sessions can be taken back', v_reinstated;
  end if;
  if p_amount > v_balance then
    raise exception 'the client has already used some of those sessions';
  end if;
  return public.apply_session_credit_change(p_athlete_id, p_group_id, -p_amount, 'adjusted', 'Reinstatement undone', null, auth.uid());
end;
$function$;

revoke all on function public.set_credit_expiry_hold(uuid, uuid, timestamptz, text) from public, anon;
grant execute on function public.set_credit_expiry_hold(uuid, uuid, timestamptz, text) to authenticated, service_role;
revoke all on function public.reinstate_expired_credits(uuid, uuid, integer, text) from public, anon;
grant execute on function public.reinstate_expired_credits(uuid, uuid, integer, text) to authenticated, service_role;
revoke all on function public.undo_expired_reinstatement(uuid, uuid, integer) from public, anon;
grant execute on function public.undo_expired_reinstatement(uuid, uuid, integer) to authenticated, service_role;
