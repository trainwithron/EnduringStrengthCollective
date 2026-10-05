-- Paste into the Supabase SQL editor and run once. Applies 0253, 0264, 0265 in that order (all three are plain policy changes and re-runnable).

-- ===== 0253_close_anon_share_policies =====
-- Close the public (anon) read policies behind shared workout cards.
--
-- /share/[postId] used to read posts, workout_logs, profiles, groups, session_exercises, set_logs and organizations as the
-- signed-out visitor, which required "anyone" read policies on all of them. Anyone holding the public API key could
-- therefore list every shared workout, its author's name and picture, every set logged in it and every group name,
-- directly from the database, with no link needed. The page now reads on the server (service role) for the one post a link
-- names, returns only what the card shows, and shortens the name to first name and last initial, so none of these
-- policies is needed.
--
-- APPLY THIS AFTER the new app code is deployed: the previous code still reads these tables as the visitor, and would
-- show "This workout card isn't available" for every public link the moment the policies go.

drop policy if exists "posts_select_public_workout_share" on public.posts;
drop policy if exists "workout_logs_select_public_workout_share" on public.workout_logs;
drop policy if exists "profiles_select_public_workout_share" on public.profiles;
drop policy if exists "groups_select_public_workout_share" on public.groups;
drop policy if exists "session_exercises_select_public_workout_share" on public.session_exercises;
drop policy if exists "set_logs_select_public_workout_share" on public.set_logs;
drop policy if exists "organizations_select_public_workout_share" on public.organizations;

-- The column grants that existed only so those policies could expose a group's name and organization to anon.
revoke select on public.groups from anon;

-- ===== 0264_session_credits_coach_only_update =====
-- A client could rewrite their own session balance (and, since 0260, their own payment hold) straight through the API.
--
-- 0085 removed the athlete's update policy on session_credits for exactly this reason. 0110's policy consolidation merged the
-- athlete and coach update policies into one ("credits_update_own_or_coach", athlete_id = the caller OR a coach of the group),
-- which put the athlete branch back. Found by the migration rehearsal: a signed-in client could run
--   update session_credits set balance = 99 where athlete_id = <themselves>
-- and bypass the ledger entirely. Every legitimate change goes through the credit functions (security definer) or the server
-- (service role), so only a coach of the group needs a direct update path, and that is all this leaves.
--
-- Additive and safe to apply at any time: nothing a client legitimately does updates this table directly.
drop policy if exists "credits_update_own_or_coach" on public.session_credits;
drop policy if exists "credits_update_coach" on public.session_credits;
create policy "credits_update_coach" on public.session_credits for update
  to authenticated
  using (public.is_group_coach(group_id))
  with check (public.is_group_coach(group_id));

-- ===== 0265_bookings_coach_only_direct_writes =====
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

