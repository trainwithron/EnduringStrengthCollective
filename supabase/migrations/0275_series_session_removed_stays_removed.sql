-- A weekly schedule with no end date is topped up every morning: any week inside the next 12 that has no booking and is not marked "skipped" is
-- booked again. When a client (or the coach, from a screen that cancels through the booking functions) cancelled or moved ONE week of such a
-- schedule, nothing marked that week as skipped, so the next morning's top-up booked it back. The coach's own "remove this week" and "move" tools
-- already record the skip; the client's cancel and reschedule buttons did not.
--
-- This records it for them: when a signed-in person cancels a confirmed session that belongs to an ongoing weekly schedule, or moves it to a new
-- time, the original start is added to that schedule's skipped list (once). It deliberately does nothing for the server's own routines (the
-- service role): pausing, ending, extending and the series tools do their own bookkeeping, and pausing then resuming must still re-book the
-- weeks it cancelled. Fixed-length schedules are untouched: they are all booked at the start, nothing tops them up.
-- Re-runnable. Needs 0259.

create or replace function public.note_series_session_skipped()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(auth.role(), '') <> 'authenticated' or new.recurring_series_id is null then
    return new;
  end if;
  if (old.status = 'confirmed' and new.status = 'cancelled')
     or (new.status = 'confirmed' and new.start_at is distinct from old.start_at) then
    update public.recurring_booking_series s
       set skipped_starts = array_append(s.skipped_starts, old.start_at),
           updated_at = now()
     where s.id = new.recurring_series_id
       and s.mode = 'ongoing'
       and not (old.start_at = any (s.skipped_starts));
  end if;
  return new;
end;
$$;

drop trigger if exists bookings_note_series_skip on public.bookings;
create trigger bookings_note_series_skip
  after update of status, start_at on public.bookings
  for each row execute function public.note_series_session_skipped();
