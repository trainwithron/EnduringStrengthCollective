-- Wave 2, calendar and team (Ron, Nov 20). Re-running is safe.

-- C2: the day-before reminder, timed to the coach's cancel window (app/api/cron/session-reminder, lib/day-before-reminder.ts). The start time it was sent for, so a
-- session moved to a new time gets a fresh one and nothing else has to reset it.
alter table public.bookings add column if not exists day_before_reminded_for timestamptz;

-- C5: a late cancel can take the session by itself, a PER-COACH setting, OFF by default (Ron, Nov 20: "as a per-coach setting"). Sessions only, never money. With it on, a client
-- cancelling inside the window loses the session at once (the same one session Charge takes), the coach is told, and one tap on Requests gives it back. With it off, nothing
-- changes: the late cancel is flagged and the coach picks Charge or Waive (Ron, Oct 6).
alter table public.coach_booking_policies add column if not exists late_cancel_takes_session boolean not null default false;
-- Requests says "Took one session (your late-cancel setting)" rather than "Charged one session" for these.
alter table public.bookings add column if not exists late_charge_auto boolean not null default false;

-- Takes the late cancel's one session (the same amount resolve_late_change's Charge takes). Only from inside cancel_booking_and_refund_credit; nobody calls it directly.
create or replace function public.take_late_cancel_session(p_booking_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_b public.bookings%rowtype;
  v_take int;
begin
  select * into v_b from public.bookings where id = p_booking_id for update;
  if not found or v_b.late_charge_state is distinct from 'flagged' or v_b.late_change_kind is distinct from 'cancel' then
    return;
  end if;
  v_take := greatest(0, 1 - public.booking_taken(p_booking_id));
  perform public.apply_session_credit_change(v_b.athlete_id, v_b.group_id, -v_take, 'delivered', 'Late cancellation (your coach''s late-cancel rule)', p_booking_id, v_b.coach_id);
  update public.bookings set late_charge_state = 'charged', late_charge_auto = true where id = p_booking_id;
end;
$$;
revoke all on function public.take_late_cancel_session(uuid) from public, anon, authenticated;

-- "Give it back": the coach undoes a charged late CANCEL (taken by the setting or by Charge). The session goes back to the client's sessions and the late cancel reads Waived.
-- The booking's own coach, or an owner or admin of the organization (the same people who may Charge or Waive).
create or replace function public.give_back_late_cancel(p_booking_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_b public.bookings%rowtype;
  v_back int;
begin
  if auth.uid() is null then
    raise exception 'not authorized';
  end if;
  select * into v_b from public.bookings where id = p_booking_id for update;
  if not found then
    raise exception 'booking not found';
  end if;
  if not ((v_b.coach_id = auth.uid() and public.is_group_coach(v_b.group_id)) or public.is_org_admin_of_group(v_b.group_id)) then
    raise exception 'not authorized';
  end if;
  if v_b.late_charge_state is distinct from 'charged' or v_b.late_change_kind is distinct from 'cancel' then
    raise exception 'this late cancel has nothing to give back';
  end if;
  v_back := least(1, greatest(0, public.booking_taken(p_booking_id)));
  if v_back > 0 then
    perform public.apply_session_credit_change(v_b.athlete_id, v_b.group_id, v_back, 'refund', 'Late cancellation given back by your coach', p_booking_id, auth.uid());
  end if;
  update public.bookings set late_charge_state = 'waived' where id = p_booking_id;
end;
$$;
revoke all on function public.give_back_late_cancel(uuid) from public, anon;
grant execute on function public.give_back_late_cancel(uuid) to authenticated;

-- The client's cancel: with the setting on, the flagged late cancel is taken at once, the refund note and the coach's notice say so. Patched into the LIVE function (each piece
-- must be found exactly once, or nothing changes), so everything else in it stays exactly as it is. Already patched: skipped.
create or replace function pg_temp.patch_once(p_def text, p_old text, p_new text) returns text language plpgsql as $f$
declare
  v_count int := (length(p_def) - length(replace(p_def, p_old, ''))) / greatest(length(p_old), 1);
begin
  if v_count <> 1 then
    raise exception 'cancel_booking_and_refund_credit: expected this exactly once, found % times. NOTHING was changed: %', v_count, left(p_old, 80);
  end if;
  return replace(p_def, p_old, p_new);
end;
$f$;

do $patch$
declare
  v_def text := replace(pg_get_functiondef('public.cancel_booking_and_refund_credit(uuid)'::regprocedure), E'\r\n', E'\n');
begin
  if position('take_late_cancel_session' in v_def) > 0 then
    return;
  end if;
  v_def := pg_temp.patch_once(v_def, E'  v_athlete_name text;\nbegin', E'  v_athlete_name text;\n  v_auto boolean := false;\nbegin');
  v_def := pg_temp.patch_once(v_def, E'  if v_late then\n', E'  if v_late then\n    -- Wave 2 C5: the coach''s late-cancel setting (off unless the coach turned it on).\n    v_auto := coalesce((select late_cancel_takes_session from public.coach_booking_policies where coach_id = v_coach_id), false);\n');
  v_def := pg_temp.patch_once(v_def, $o$'Booking cancelled inside the window; your coach decides if it counts'$o$,
    $n$case when v_auto then 'Booking cancelled inside the window' else 'Booking cancelled inside the window; your coach decides if it counts' end$n$);
  v_def := pg_temp.patch_once(v_def, E'    select full_name into v_athlete_name from public.profiles where id = v_athlete_id;\n',
    E'    if v_auto then\n      perform public.take_late_cancel_session(p_booking_id);\n    end if;\n    select full_name into v_athlete_name from public.profiles where id = v_athlete_id;\n');
  v_def := pg_temp.patch_once(v_def, $o$|| '-hour window. Charge it or waive it.',$o$,
    $n$|| '-hour window. ' || case when v_auto then 'It came off their sessions (your late-cancel setting). Give it back on Requests if you like.' else 'Charge it or waive it.' end,$n$);
  execute v_def;
end
$patch$;
