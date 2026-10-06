-- STEP 27: 0284 a coach can propose a goal to a client, and the client confirms it, changes it or declines it (a coach cannot confirm it for them)
--
-- Run apply-precheck first (every row ok = true). Then paste THIS file and run it once.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."
-- AFTERWARDS: Nothing visible changes at once. After the code deploy: on a client's profile a coach can suggest a goal; the client sees it on My Goal with Looks right, Change it and Not now, and the coach is told how they answered. A goal a client proposes still waits for the coach exactly as before.
-- ON ERROR: it is all or nothing, so nothing was applied. Run   rollback;   once, copy the red error text, and send it back. Do not run the file again.
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

do $guard$
begin
  if not ((not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'client_goals' and policyname = 'client_goals_insert_coach'))) then
    raise exception 'Step 27 (0284) looks already applied, or the database is not in the state it expects. Nothing was changed. Run the precheck file and send Spot the result.';
  end if;
end
$guard$;

-- ====================================================================================================
-- migration 0284_coach_proposed_goals.sql
-- ====================================================================================================

-- A coach can propose a goal to a client, and the client answers it (Ron, Oct 6). Until now only a client proposed a goal and only the coach confirmed it.
-- The rule stays "both sides agree before a goal drives anything": whoever AUTHORED the latest version of a goal is waiting on the other person.
--
--  * created_by on a goal that is still 'proposed' says who is waiting: the client authored it (waiting on the coach, exactly as before) or the coach
--    authored it (waiting on the client).
--  * A coach inserts a goal for one of their own clients (status 'proposed', created_by = the coach). The client can then confirm it as it is, change it
--    (a counter-proposal that goes back to the coach), or decline it. A coach cannot confirm a goal on the client's behalf.
--  * Changing the content of a goal that is waiting on you makes you its author, so it goes back to the other person. A coach changing a client's
--    proposal therefore goes back to the client rather than silently confirming.
--  * Confirming sets who confirmed and when, from the caller, never from what was sent. Which client, which group and when it was made cannot be changed.
--  * Each side gets an in-app notice (the app also sends a push): goal_proposed to the client, goal_answered to the coach (or to the client when the
--    coach answers a client's proposal).
-- Everything the server does (service role) and the SQL editor is unaffected. Needs client_goals (0152). Re-running replaces the functions again.

alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in (
    'comment', 'program_assigned', 'macros_assigned', 'partner_request',
    'partner_request_accepted', 'milestone_celebration', 'gym_visitor_lead',
    'trainer_dispatch_offer', 'trainer_dispatch_question', 'session_pattern_note',
    'credits_expired', 'waitlist_slot_offered', 'recurring_booking_conflict',
    'email_changed', 'direct_message', 'late_change', 'booking_request', 'request_decision',
    'goal_proposed', 'goal_answered'
  ));

-- A coach proposes a goal for one of their own clients.
drop policy if exists "client_goals_insert_coach" on public.client_goals;
create policy "client_goals_insert_coach" on public.client_goals for insert
  to authenticated
  with check (
    public.is_group_coach(group_id)
    and created_by = (select auth.uid())
    and athlete_id <> (select auth.uid())
    and status = 'proposed'
    and confirmed_at is null
    and confirmed_by is null
    and exists (
      select 1 from public.group_memberships gm
      where gm.group_id = client_goals.group_id and gm.profile_id = client_goals.athlete_id and gm.role = 'athlete'
    )
  );

-- A client answers a goal their coach proposed (the trigger below decides what an answer may do).
drop policy if exists "client_goals_update_athlete_answers" on public.client_goals;
create policy "client_goals_update_athlete_answers" on public.client_goals for update
  to authenticated
  using (athlete_id = (select auth.uid()) and status = 'proposed' and created_by <> (select auth.uid()))
  with check (athlete_id = (select auth.uid()));

create or replace function public.guard_client_goal_update()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_ignore text[] := array['status', 'created_by', 'confirmed_at', 'confirmed_by'];
  v_changed boolean;
begin
  if coalesce(auth.role(), '') not in ('authenticated', 'anon') then
    return new;
  end if;
  -- Never movable by an end user.
  new.athlete_id := old.athlete_id;
  new.group_id := old.group_id;
  new.created_at := old.created_at;
  v_changed := (to_jsonb(new) - v_ignore) is distinct from (to_jsonb(old) - v_ignore);

  if v_uid = old.athlete_id and not coalesce(public.is_group_coach(old.group_id), false) then
    -- The client answering a goal that is waiting on them.
    if old.status <> 'proposed' or old.created_by = v_uid then
      raise exception 'That goal is not waiting on you.';
    end if;
    if v_changed then
      -- A counter-proposal: the client is now the author, so it goes back to the coach.
      new.status := 'proposed';
      new.created_by := v_uid;
      new.confirmed_at := null;
      new.confirmed_by := null;
      return new;
    end if;
    if new.status = 'confirmed' then
      new.created_by := old.created_by;
      new.confirmed_at := now();
      new.confirmed_by := v_uid;
      return new;
    end if;
    if new.status = 'declined' then
      new.created_by := old.created_by;
      new.confirmed_at := null;
      new.confirmed_by := null;
      return new;
    end if;
    raise exception 'Confirm, change or decline the goal.';
  end if;

  if coalesce(public.is_group_coach(old.group_id), false) then
    if old.status = 'proposed' and old.created_by <> old.athlete_id and new.status = 'confirmed' then
      raise exception 'Only the client can confirm a goal their coach suggested.';
    end if;
    if old.status = 'proposed' and v_changed then
      -- Changing a goal that is still being agreed makes the coach its author, so it goes to the client.
      new.status := 'proposed';
      new.created_by := v_uid;
      new.confirmed_at := null;
      new.confirmed_by := null;
      return new;
    end if;
    if new.status = 'confirmed' and old.status is distinct from 'confirmed' then
      new.confirmed_at := now();
      new.confirmed_by := v_uid;
    end if;
  end if;
  return new;
end;
$function$;

drop trigger if exists client_goals_guard_update on public.client_goals;
create trigger client_goals_guard_update
  before update on public.client_goals
  for each row execute function public.guard_client_goal_update();

create or replace function public.notify_on_client_goal()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_label text := coalesce(nullif(btrim(new.custom_label), ''), initcap(replace(new.goal_type, '_', ' ')));
  v_name text;
  v_actor uuid := coalesce(auth.uid(), new.created_by);
  v_athlete_path text := '/groups/' || new.group_id::text || '/goal';
  v_coach_path text := '/groups/' || new.group_id::text || '/athletes/' || new.athlete_id::text;
  c record;
begin
  select coalesce(nullif(btrim(full_name), ''), 'Your client') into v_name from public.profiles where id = new.athlete_id;

  if tg_op = 'INSERT' then
    -- A coach proposing: tell the client.
    if new.status = 'proposed' and new.created_by <> new.athlete_id then
      insert into public.notifications (profile_id, group_id, type, body, link_path)
      values (new.athlete_id, new.group_id, 'goal_proposed', 'Your coach suggested a goal: ' || v_label, v_athlete_path);
    end if;
    return new;
  end if;

  -- Went back and forth: a new author on a goal still being agreed.
  if new.status = 'proposed' and new.created_by is distinct from old.created_by then
    if new.created_by = new.athlete_id then
      for c in select profile_id from public.group_memberships where group_id = new.group_id and role = 'coach' and profile_id <> v_actor loop
        insert into public.notifications (profile_id, group_id, type, body, link_path)
        values (c.profile_id, new.group_id, 'goal_answered', v_name || ' suggested a change to the goal: ' || v_label, v_coach_path);
      end loop;
    else
      insert into public.notifications (profile_id, group_id, type, body, link_path)
      values (new.athlete_id, new.group_id, 'goal_proposed', 'Your coach suggested a change to your goal: ' || v_label, v_athlete_path);
    end if;
    return new;
  end if;

  -- Settled: confirmed or declined by the other side.
  if old.status = 'proposed' and new.status in ('confirmed', 'declined') then
    if v_actor = new.athlete_id then
      for c in select profile_id from public.group_memberships where group_id = new.group_id and role = 'coach' and profile_id <> v_actor loop
        insert into public.notifications (profile_id, group_id, type, body, link_path)
        values (c.profile_id, new.group_id, 'goal_answered', v_name || (case when new.status = 'confirmed' then ' confirmed the goal: ' else ' declined the goal: ' end) || v_label, v_coach_path);
      end loop;
    else
      insert into public.notifications (profile_id, group_id, type, body, link_path)
      values (new.athlete_id, new.group_id, 'goal_answered', 'Your coach ' || (case when new.status = 'confirmed' then 'confirmed' else 'declined' end) || ' your goal: ' || v_label, v_athlete_path);
    end if;
  end if;
  return new;
end;
$function$;

drop trigger if exists client_goals_notify on public.client_goals;
create trigger client_goals_notify
  after insert or update on public.client_goals
  for each row execute function public.notify_on_client_goal();

commit;
