-- PASTE: step 214 (wave 2 calendar and team: the day-before reminder, the weekly sessions-to-mark record, the late-cancel setting with give-back, and the coach's locked tested max). Paste all of it into the Supabase SQL editor and run. Last result: one row, all true.

begin;

-- Wave 2, calendar and team (Ron, Nov 20). Re-running is safe.

-- C2: the day-before reminder, timed to the coach's cancel window (app/api/cron/session-reminder, lib/day-before-reminder.ts). The start time it was sent for, so a
-- session moved to a new time gets a fresh one and nothing else has to reset it.
alter table public.bookings add column if not exists day_before_reminded_for timestamptz;

-- C6: the weekly "sessions to mark" line. When a coach was last actually reached (a phone or an email), so they get at most one in six days and a run that could not reach
-- them tries again next time. Only the server reads or writes it (row security on, no rules).
create table if not exists public.coach_nudges (
  coach_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null,
  sent_at timestamptz not null default now(),
  primary key (coach_id, kind)
);
alter table public.coach_nudges enable row level security;
revoke all on public.coach_nudges from anon, authenticated;

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

-- T2: a coach-typed TESTED max per athlete per lift, LOCKED so the estimates from logged sets never overwrite it (Ron, Nov 20). It is kept in the same training-max row every
-- program rule already reads (a percent of max, the wave rules, the AI builder), so they all use it with no other change. Unlocking it goes back to the estimate from logged sets.
-- Who set it and when are kept on the row.
alter table public.athlete_training_maxes
  add column if not exists locked boolean not null default false,
  add column if not exists tested_by uuid references public.profiles(id) on delete set null,
  add column if not exists tested_at timestamptz;

-- A coach of the athlete types the max (pounds, as every weight is stored). Locked at once.
create or replace function public.set_tested_max(p_athlete uuid, p_exercise text, p_weight numeric)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_name text := btrim(coalesce(p_exercise, ''));
begin
  if auth.uid() is null or not public.is_coach_of_athlete(p_athlete) then
    raise exception 'not authorized';
  end if;
  if v_name = '' or length(v_name) > 120 then
    raise exception 'name the lift';
  end if;
  if p_weight is null or p_weight <= 0 or p_weight > 2000 then
    raise exception 'a tested max is a weight from 1 to 2000 lb';
  end if;
  insert into public.athlete_training_maxes (athlete_id, exercise_name, estimated_max, source_weight, source_reps, source_rpe, source_rpe_assumed, updated_at, locked, tested_by, tested_at)
  values (p_athlete, v_name, round(p_weight, 1), round(p_weight, 1), 1, 10, false, now(), true, auth.uid(), now())
  on conflict (athlete_id, exercise_name) do update
    set estimated_max = excluded.estimated_max,
        source_weight = excluded.source_weight,
        source_reps = 1,
        source_rpe = 10,
        source_rpe_assumed = false,
        updated_at = now(),
        locked = true,
        tested_by = excluded.tested_by,
        tested_at = excluded.tested_at;
end;
$$;
revoke all on function public.set_tested_max(uuid, text, numeric) from public, anon;
grant execute on function public.set_tested_max(uuid, text, numeric) to authenticated;

-- Unlock: back to the estimate from the athlete's logged sets (none logged: no max).
create or replace function public.unlock_tested_max(p_athlete uuid, p_exercise text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or not public.is_coach_of_athlete(p_athlete) then
    raise exception 'not authorized';
  end if;
  update public.athlete_training_maxes set locked = false, tested_by = null, tested_at = null
    where athlete_id = p_athlete and exercise_name = p_exercise and locked;
  perform public.recompute_training_maxes_internal(p_athlete, p_exercise);
end;
$$;
revoke all on function public.unlock_tested_max(uuid, text) from public, anon;
grant execute on function public.unlock_tested_max(uuid, text) to authenticated;

-- The two estimate writers leave a locked max alone: the set-by-set trigger, and the full recompute (which also never deletes a locked one). Patched into the LIVE functions,
-- each piece found exactly once or nothing changes; already patched: skipped.
create or replace function pg_temp.patch_tm(p_fn text, p_def text, p_old text, p_new text) returns text language plpgsql as $f$
declare
  v_count int := (length(p_def) - length(replace(p_def, p_old, ''))) / greatest(length(p_old), 1);
begin
  if v_count <> 1 then
    raise exception '%: expected this exactly once, found % times. NOTHING was changed: %', p_fn, v_count, left(p_old, 80);
  end if;
  return replace(p_def, p_old, p_new);
end;
$f$;

do $tm$
declare
  v_def text;
begin
  v_def := replace(pg_get_functiondef('public.recompute_training_max()'::regprocedure), E'\r\n', E'\n');
  if position('not public.athlete_training_maxes.locked' in v_def) = 0 then
    v_def := pg_temp.patch_tm('recompute_training_max', v_def, E'    where excluded.estimated_max > public.athlete_training_maxes.estimated_max;',
      E'    where excluded.estimated_max > public.athlete_training_maxes.estimated_max\n      and not public.athlete_training_maxes.locked;');
    execute v_def;
  end if;

  v_def := replace(pg_get_functiondef('public.recompute_training_maxes_internal(uuid, text)'::regprocedure), E'\r\n', E'\n');
  if position('not public.athlete_training_maxes.locked' in v_def) = 0 then
    v_def := pg_temp.patch_tm('recompute_training_maxes_internal', v_def, E'      and not exists (select 1 from best b where b.exercise_name = m.exercise_name)\n',
      E'      and not exists (select 1 from best b where b.exercise_name = m.exercise_name)\n      and not m.locked\n');
    v_def := pg_temp.patch_tm('recompute_training_maxes_internal', v_def, E'else public.athlete_training_maxes.updated_at end\n    returning 1',
      E'else public.athlete_training_maxes.updated_at end\n      where not public.athlete_training_maxes.locked\n    returning 1');
    execute v_def;
  end if;
end
$tm$;

commit;

-- Check: one row, all true.
select
  exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'bookings' and column_name = 'day_before_reminded_for') as day_before_reminder_ready,
  (select relrowsecurity from pg_class where oid = 'public.coach_nudges'::regclass) and not has_table_privilege('authenticated', 'public.coach_nudges', 'select') as nudge_record_server_only,
  (select column_default = 'false' from information_schema.columns where table_schema = 'public' and table_name = 'coach_booking_policies' and column_name = 'late_cancel_takes_session') as late_cancel_setting_off_by_default,
  position('take_late_cancel_session' in (select prosrc from pg_proc where oid = 'public.cancel_booking_and_refund_credit(uuid)'::regprocedure)) > 0 as cancel_uses_the_setting,
  not has_function_privilege('authenticated', 'public.take_late_cancel_session(uuid)', 'execute') as only_the_cancel_takes_a_session,
  has_function_privilege('authenticated', 'public.give_back_late_cancel(uuid)', 'execute') and not has_function_privilege('anon', 'public.give_back_late_cancel(uuid)', 'execute') as coaches_can_give_back,
  has_function_privilege('authenticated', 'public.set_tested_max(uuid, text, numeric)', 'execute') and not has_function_privilege('anon', 'public.set_tested_max(uuid, text, numeric)', 'execute') as coaches_can_set_tested_max,
  (select count(*) from pg_proc where proname in ('recompute_training_max', 'recompute_training_maxes_internal') and position('not public.athlete_training_maxes.locked' in prosrc) > 0) = 2 as estimates_leave_tested_max_alone;
