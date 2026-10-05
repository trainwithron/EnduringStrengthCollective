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
      new.is_platform_admin := false;
      new.claimed_at := null;
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
