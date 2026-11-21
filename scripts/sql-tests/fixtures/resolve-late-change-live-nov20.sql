-- The LIVE public.resolve_late_change as it was on Nov 20 (md5 of its body 0010aa033f297f17b1feea309f052d4c; live, its lines end in CR LF: the rehearsal puts them back after git, whatever git does to this file).
CREATE OR REPLACE FUNCTION public.resolve_late_change(p_booking_id uuid, p_charge boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_athlete_id uuid;
  v_group_id uuid;
  v_coach_id uuid;
  v_state text;
  v_kind text;
  v_credit_state text;
  v_status text;
  v_take int;
begin
  if auth.uid() is null and auth.role() is distinct from 'service_role' then
    raise exception 'not authorized';
  end if;

  select athlete_id, group_id, coach_id, late_charge_state, late_change_kind, credit_state, status
    into v_athlete_id, v_group_id, v_coach_id, v_state, v_kind, v_credit_state, v_status
  from public.bookings where id = p_booking_id
  for update;

  if v_athlete_id is null then
    raise exception 'booking not found';
  end if;
  -- The booking's own coach decides (or an owner or admin of the organization), not just any coach of the group.
  if auth.role() is distinct from 'service_role'
     and not ((v_coach_id = auth.uid() and public.is_group_coach(v_group_id)) or public.is_org_admin_of_group(v_group_id)) then
    raise exception 'not authorized';
  end if;
  if v_state is distinct from 'flagged' then
    raise exception 'this change is not waiting for a decision';
  end if;

  if p_charge then
    -- The visit's ONE session (Ron, Oct 19: a late move "should only be one session"): take only what this booking has not already taken (paid when it was booked, or settled
    -- when it happened: nothing more; given back when it was cancelled: one). Always recorded, a 0 entry when nothing more is taken, so a charged late move stays this visit's one
    -- session whatever is undone later. A second late move of a session already charged for one: nothing at all.
    if v_kind = 'reschedule' and public.booking_late_move_charged(p_booking_id) then
      null;
    else
      v_take := greatest(0, 1 - public.booking_taken(p_booking_id));
      perform public.apply_session_credit_change(v_athlete_id, v_group_id, -v_take, 'delivered',
        case when v_kind = 'reschedule' then 'Late reschedule, charged by your coach' else 'Late cancellation, charged by your coach' end, p_booking_id, auth.uid());
      if v_take > 0 and v_status = 'confirmed' then
        update public.bookings set credit_state = 'settled' where id = p_booking_id;
      end if;
    end if;
    update public.bookings set late_charge_state = 'charged' where id = p_booking_id;
  else
    update public.bookings set late_charge_state = 'waived' where id = p_booking_id;
  end if;
end;
$function$
;
