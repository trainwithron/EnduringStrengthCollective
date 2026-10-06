-- STEP 33: 0288 two bookings that overlap at different minutes can no longer both be saved at the same instant (a lock per coach, then a second overlap check before a confirmed future booking is saved or moved)
--
-- Run apply-precheck first (every row ok = true). Then paste THIS file and run it once.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."
-- AFTERWARDS: Nothing visible changes. A booking, a confirmed request, a weekly schedule or the public discovery form that would overlap another session (with your gap) is refused with the usual 'that slot was just taken', even if two arrive at the same moment. History is never re-checked. Run this after step 32.
-- ON ERROR: it is all or nothing, so nothing was applied. Run   rollback;   once, copy the red error text, and send it back. Do not run the file again.
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

do $guard$
begin
  if not ((not exists (select 1 from pg_trigger where tgname = 'bookings_guard_overlap'))) then
    raise exception 'Step 33 (0288) looks already applied, or the database is not in the state it expects. Nothing was changed. Run the precheck file and send Spot the result.';
  end if;
end
$guard$;

-- ====================================================================================================
-- migration 0288_booking_overlap_lock.sql
-- ====================================================================================================

-- Two bookings that overlap but start at different minutes can no longer both be saved at the same instant (Assistant's review of 0287, Oct 6).
--
-- Until now the only database guard against a double booking was the unique index on (coach_id, start_at): it catches two bookings at the same start, which
-- was enough while every session started on a slot. Now that a session can start at any minute and slots can overlap (a start every 15 minutes with a 55-minute
-- session), two bookings at 10:00 and 10:15 have different starts, and book_session, reschedule_booking, resolve_booking_request and book_discovery_call all
-- check for an overlap and then insert: two requests arriving together can both pass the check before either has saved.
--
-- The fix is one trigger on bookings and one on discovery_bookings. Before a confirmed future booking is saved (or moved), the trigger takes a lock that is
-- per coach (so one coach's bookings are saved one at a time and nobody else waits), and then looks again for an overlap, with the coach's gap (buffer) on
-- both sides, exactly as the booking functions do. The second of two simultaneous bookings waits for the first to commit and then sees it, and is refused with
-- the same message the functions use ("that slot was just taken"). The functions themselves are not changed: this is a safety net under every way a booking
-- is written (a client, the coach, a weekly schedule, a confirmed request, the public discovery form).
--
--  * Only a booking that is confirmed and has not ended yet is checked, so history is never touched or re-checked (a past session can be recorded, marked
--    attended or edited as before), and cancelling a booking is never refused.
--  * An update is checked only when the booking's start, end or status changes (moving it, or confirming it), not for other edits.
--  * The function runs with the owner's rights because it must see other clients' bookings; nobody signed in can call it directly.
-- Needs bookings (0023), discovery_bookings (0089) and coach_booking_policies (0068/0208). Re-runnable.

create or replace function public.guard_booking_overlap()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_buffer_minutes int;
begin
  if new.status is distinct from 'confirmed' or new.end_at <= now() then
    return new;
  end if;
  if tg_op = 'UPDATE'
     and new.start_at is not distinct from old.start_at
     and new.end_at is not distinct from old.end_at
     and old.status is not distinct from new.status then
    return new;
  end if;

  -- One lock per coach, held until this transaction ends, taken before the check so a second booking waits and then sees the first.
  perform pg_advisory_xact_lock(hashtextextended('booking:' || new.coach_id::text, 0));

  select coalesce(bp.buffer_minutes, 0) into v_buffer_minutes from public.coach_booking_policies bp where bp.coach_id = new.coach_id;
  v_buffer_minutes := coalesce(v_buffer_minutes, 0);

  if exists (
    select 1 from public.bookings b
    where b.coach_id = new.coach_id
      and b.status = 'confirmed'
      and (tg_table_name <> 'bookings' or b.id is distinct from new.id)
      and b.start_at < (new.end_at + make_interval(mins => v_buffer_minutes))
      and b.end_at > (new.start_at - make_interval(mins => v_buffer_minutes))
  ) or exists (
    select 1 from public.discovery_bookings d
    where d.coach_id = new.coach_id
      and d.status = 'confirmed'
      and (tg_table_name <> 'discovery_bookings' or d.id is distinct from new.id)
      and d.start_at < (new.end_at + make_interval(mins => v_buffer_minutes))
      and d.end_at > (new.start_at - make_interval(mins => v_buffer_minutes))
  ) then
    raise exception 'that slot was just taken';
  end if;
  return new;
end;
$function$;

-- Not callable by anyone signed in or signed out: it only ever runs as a trigger.
revoke all on function public.guard_booking_overlap() from public, anon, authenticated;

drop trigger if exists bookings_guard_overlap on public.bookings;
create trigger bookings_guard_overlap
  before insert or update of start_at, end_at, status on public.bookings
  for each row execute function public.guard_booking_overlap();

drop trigger if exists discovery_bookings_guard_overlap on public.discovery_bookings;
create trigger discovery_bookings_guard_overlap
  before insert or update of start_at, end_at, status on public.discovery_bookings
  for each row execute function public.guard_booking_overlap();

commit;
