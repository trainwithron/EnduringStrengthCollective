-- Paste into the Supabase SQL editor and run once. Applies 0264, 0265, 0266 and 0253, in that order, in one transaction.
-- Every statement is a policy, trigger or function change that drops or replaces what it creates, so running it twice is harmless.
-- 0266 is the most urgent (a new account could create its own profile as platform admin; a client could switch off their waiver gate).

begin;

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

-- ===== 0266_client_write_column_guards =====
-- Columns a client could change on their own rows through the API that only a coach or the server should.
--
-- Row security says WHICH rows a person may write, not which columns. Several tables let a client update their own row, and a few
-- columns on those rows decide things the client must not decide. Found by the migration rehearsal's policy sweep (the live policy list
-- matches the rehearsal schema exactly) and proven there as a real client role before this fix:
--   profiles          intake_required (a client could switch their own waiver gate off), claimed_at, and is_platform_admin on INSERT
--                     (0085 guards only the update)
--   client_goals      a client could insert a goal already "confirmed", skipping the coach's confirmation that governs nutrition targets
--   athlete_sessions  logged_by_coach, deduct_session_credit, booking_id, is_historical (marking a completed session historical turns
--                     off the 0236 edit block), and who/where the session belongs to
--   workout_logs      total_volume, total_sets_completed, new_prs and the rest of the record (leaderboards, PR cards, the coach's history)
--   posts             pinning your own post, moving it into Announcements (insert refuses it, update did not), reassigning its author
--   direct_messages   the recipient could rewrite the sender and the body, not just mark it read
--   training_partner_requests  the recipient could rewrite who the request is from and what it said
-- Same approach as 0085: a trigger puts the protected columns back (or refuses) for an end user, and leaves the service role, the SQL
-- editor and a coach of the group alone, so nothing the app does through the server or a coach changes. The functions that complete a
-- workout and settle a booking only touch status and credit fields, which are not guarded. Additive and safe to apply at any time.

-- ---- profiles ---------------------------------------------------------------------------------------------------------------------
create or replace function public.guard_profile_sensitive_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() in ('authenticated', 'anon') then
    if tg_op = 'INSERT' then
      -- A profile an end user creates for themselves is a client's: never an admin, never already claimed, and always through the
      -- waiver gate (the invite page is the only browser code that inserts one, and it sets intake_required itself).
      new.is_platform_admin := false;
      new.claimed_at := null;
      new.intake_required := true;
    else
      new.intake_required := old.intake_required;
      new.claimed_at := old.claimed_at;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_guard_sensitive_columns on public.profiles;
create trigger profiles_guard_sensitive_columns
  before insert or update on public.profiles
  for each row execute function public.guard_profile_sensitive_columns();

-- ---- client_goals: a client proposes, the coach confirms --------------------------------------------------------------------------
drop policy if exists "client_goals_insert_own" on public.client_goals;
create policy "client_goals_insert_own" on public.client_goals for insert
  to authenticated
  with check (
    athlete_id = (select auth.uid())
    and created_by = (select auth.uid())
    and status = 'proposed'
    and confirmed_at is null
    and confirmed_by is null
  );

-- ---- athlete_sessions -------------------------------------------------------------------------------------------------------------
create or replace function public.guard_athlete_session_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() in ('authenticated', 'anon') and not coalesce(public.is_group_coach(old.group_id), false) then
    new.logged_by_coach := old.logged_by_coach;
    new.deduct_session_credit := old.deduct_session_credit;
    new.booking_id := old.booking_id;
    new.is_historical := old.is_historical;
    new.session_type_id := old.session_type_id;
    new.athlete_id := old.athlete_id;
    new.group_id := old.group_id;
    new.workout_id := old.workout_id;
  end if;
  return new;
end;
$$;

drop trigger if exists athlete_sessions_guard_columns on public.athlete_sessions;
create trigger athlete_sessions_guard_columns
  before update on public.athlete_sessions
  for each row execute function public.guard_athlete_session_columns();

-- ---- workout_logs -----------------------------------------------------------------------------------------------------------------
create or replace function public.guard_workout_log_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() in ('authenticated', 'anon') and not coalesce(public.is_group_coach(old.group_id), false) then
    new.total_volume := old.total_volume;
    new.total_sets_completed := old.total_sets_completed;
    new.total_duration_seconds := old.total_duration_seconds;
    new.new_prs := old.new_prs;
    new.logged_by_coach := old.logged_by_coach;
    new.athlete_id := old.athlete_id;
    new.group_id := old.group_id;
    new.session_id := old.session_id;
    new.workout_id := old.workout_id;
    new.created_at := old.created_at;
  end if;
  return new;
end;
$$;

drop trigger if exists workout_logs_guard_columns on public.workout_logs;
create trigger workout_logs_guard_columns
  before update on public.workout_logs
  for each row execute function public.guard_workout_log_columns();

-- ---- posts ------------------------------------------------------------------------------------------------------------------------
create or replace function public.guard_post_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() in ('authenticated', 'anon') and not coalesce(public.is_group_coach(old.group_id), false) then
    if new.channel = 'announcements' and new.channel is distinct from old.channel then
      raise exception 'Only a coach can post to Announcements.';
    end if;
    new.pinned_at := old.pinned_at;
    new.author_id := old.author_id;
    new.group_id := old.group_id;
    new.post_type := old.post_type;
    new.workout_log_id := old.workout_log_id;
    new.created_at := old.created_at;
  end if;
  return new;
end;
$$;

drop trigger if exists posts_guard_columns on public.posts;
create trigger posts_guard_columns
  before update on public.posts
  for each row execute function public.guard_post_columns();

-- ---- direct_messages: the recipient may only mark a message read -------------------------------------------------------------------
create or replace function public.guard_direct_message_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() in ('authenticated', 'anon') then
    new.group_id := old.group_id;
    new.sender_id := old.sender_id;
    new.recipient_id := old.recipient_id;
    new.body := old.body;
    new.created_at := old.created_at;
    new.broadcast_batch_id := old.broadcast_batch_id;
  end if;
  return new;
end;
$$;

drop trigger if exists direct_messages_guard_columns on public.direct_messages;
create trigger direct_messages_guard_columns
  before update on public.direct_messages
  for each row execute function public.guard_direct_message_columns();

-- ---- training_partner_requests: the recipient may only answer ---------------------------------------------------------------------
create or replace function public.guard_partner_request_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() in ('authenticated', 'anon') then
    new.from_athlete_id := old.from_athlete_id;
    new.to_athlete_id := old.to_athlete_id;
    new.message := old.message;
    new.created_at := old.created_at;
  end if;
  return new;
end;
$$;

drop trigger if exists training_partner_requests_guard_columns on public.training_partner_requests;
create trigger training_partner_requests_guard_columns
  before update on public.training_partner_requests
  for each row execute function public.guard_partner_request_columns();

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

commit;
