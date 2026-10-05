-- A client could book, edit and cancel their own sessions directly through the API, skipping every rule the booking functions enforce.
--
-- bookings had an insert policy for "your own booking as a training client of the group" and an update policy for "your own booking",
-- both with no limit on which columns. So a signed-in client could:
--   * insert a booking with credit_state 'settled' or 'waived' (a session that takes nothing), at any time (outside availability,
--     inside the coach's notice window, in a slot the buffer rules would refuse);
--   * flip a coach-created booking to 'waived' so attending it is never charged;
--   * cancel a booking late without the forfeit, or move it to any time.
-- Found by the migration rehearsal, and the same policies are on the live database today.
--
-- Everything a client legitimately does goes through book_session, cancel_booking_and_refund_credit and reschedule_booking, which are
-- security definer and enforce the rules; the server routes use the service role. Direct writes are left to the coach of the booking.
-- Additive and safe to apply at any time: no client screen writes this table directly (checked in the code).
drop policy if exists "bookings_insert_by_coach_or_own_client" on public.bookings;
drop policy if exists "bookings_insert_by_coach" on public.bookings;
create policy "bookings_insert_by_coach" on public.bookings for insert
  to authenticated
  with check (coach_id = (select auth.uid()) and public.is_group_coach(group_id));

drop policy if exists "bookings_update_own_or_coach" on public.bookings;
drop policy if exists "bookings_update_coach" on public.bookings;
create policy "bookings_update_coach" on public.bookings for update
  to authenticated
  using (coach_id = (select auth.uid()))
  with check (coach_id = (select auth.uid()));
