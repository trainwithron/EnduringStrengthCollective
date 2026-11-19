-- The coach marks a session as cancelled by the client, from the calendar's right-click / press-and-hold menu (Ron, Nov 19: "Amber canceled her session this morning and I
-- have no way to just say cancel charge or something like that"). Before or after the start time, one call, the coach's choice:
--   charge     = a late cancellation the client pays for: the visit's ONE session is taken (only what this booking has not already taken), the same way Charge on a flagged
--                late cancel does (resolve_late_change). A late move already charged for this visit is that one session: nothing more.
--   no charge  = the same as the coach cancelling: anything already taken for it goes back to the client's sessions.
-- Either way the session is cancelled (off the calendar) and recorded as the client's late cancel (late_cancel, late_change_kind 'cancel', late_charge_state charged / waived), so
-- it reads as a cancellation everywhere, not a no-show. A freed future time is offered to the waitlist as any cancellation is. Only the booking's own coach (or an owner or admin of
-- the organization) can do it, as for Charge / Waive. Re-running is safe.

create or replace function public.mark_client_cancelled(p_booking_id uuid, p_charge boolean)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_b public.bookings%rowtype;
  v_take int;
  v_back int;
begin
  if auth.uid() is null and auth.role() is distinct from 'service_role' then
    raise exception 'not authorized';
  end if;

  select * into v_b from public.bookings where id = p_booking_id for update;
  if not found then
    raise exception 'booking not found';
  end if;
  if auth.role() is distinct from 'service_role'
     and not ((v_b.coach_id = auth.uid() and public.is_group_coach(v_b.group_id)) or public.is_org_admin_of_group(v_b.group_id)) then
    raise exception 'not authorized';
  end if;
  if v_b.status <> 'confirmed' then
    raise exception 'only a booked session can be marked cancelled';
  end if;
  if v_b.attended_at is not null then
    raise exception 'this session was marked as happened; undo that first';
  end if;
  if v_b.no_show then
    raise exception 'this session is marked a no-show; undo that first';
  end if;

  if p_charge then
    if not public.booking_late_move_charged(p_booking_id) then
      v_take := greatest(0, 1 - public.booking_taken(p_booking_id));
      perform public.apply_session_credit_change(v_b.athlete_id, v_b.group_id, -v_take, 'delivered', 'Late cancellation, charged by your coach', p_booking_id, auth.uid());
      if v_take > 0 then
        update public.bookings set credit_state = 'settled' where id = p_booking_id;
      end if;
    end if;
    update public.bookings
      set status = 'cancelled', late_cancel = true, late_change_kind = 'cancel', late_charge_state = 'charged'
      where id = p_booking_id;
  else
    v_back := least(1, public.booking_taken(p_booking_id));
    if v_b.credit_state in ('prepaid', 'settled') and v_back > 0 then
      perform public.apply_session_credit_change(v_b.athlete_id, v_b.group_id, v_back, 'refund', 'Session cancelled, not charged', p_booking_id, auth.uid());
    end if;
    update public.bookings
      set status = 'cancelled', late_cancel = true, late_change_kind = 'cancel', late_charge_state = 'waived'
      where id = p_booking_id;
  end if;

  if v_b.start_at > now() then
    perform public.offer_freed_slot_to_waitlist(v_b.coach_id, v_b.start_at, v_b.end_at);
  end if;
end;
$function$;

revoke all on function public.mark_client_cancelled(uuid, boolean) from public, anon;
grant execute on function public.mark_client_cancelled(uuid, boolean) to authenticated, service_role;
