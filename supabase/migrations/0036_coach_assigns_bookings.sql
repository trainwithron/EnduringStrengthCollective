-- A coach can now assign a session directly onto a client's calendar
-- (from the client's profile, or from the coach's own main calendar),
-- not just have a client self-book. The existing insert policy only let
-- an athlete book themselves; this adds the coach-initiated path, scoped
-- the same way every other coach-manages-their-own-group policy is.
create policy "bookings_insert_by_coach" on public.bookings for insert
  to authenticated
  with check (coach_id = auth.uid() and public.is_group_coach(group_id));
