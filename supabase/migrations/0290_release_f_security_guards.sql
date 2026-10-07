-- Release F, part 1: four small database closures from the Assistant's Oct 7 audit (r2_02a H1, H2, M2; r2_03a H2; r2_05 ONB-01). Nothing here changes what the app
-- does for a normal person; each one removes a way to do something the app never does.
--
-- 1. A coach could re-point an existing membership row at ANY signed-in person (update group_memberships set profile_id = <someone>), which re-opens exactly the
--    hole 0270 closed (the "athlete" then appears in the coach's view with their phone number, wearable data and push keys). Nothing in the app ever changes
--    profile_id on a membership, so a BEFORE UPDATE trigger now refuses it for a signed-in caller (the server and the database owner are unaffected).
-- 2. spend_coach_credits() accepted a negative cost, so any signed-in account could ADD AI credits to its own balance. The function has no caller in the app.
--    It now refuses a negative or missing cost and, like the other money functions, only the server can run it.
-- 3. spend_ai_action() trusted the allowance and the cost sent by the browser (a metered coach could send "allowance 1000000" or a negative cost). It is now
--    server-only: the AI routes call it with the service role, after they have checked who is signed in, and the numbers come from the server's own table.
--    It still refuses a negative or missing amount. (lib/coach-credits.ts is changed in the same release to call it with the service role.)
-- 4. Two private video buckets (an athlete's form-check videos, a coach's video check-ins) could be read by every member of the group. They are now readable by
--    the person they belong to and the group's coaches, which is what the tables already said.
-- 5. A client who joined by invite link was never marked as having claimed their account (the profile guard of 0266 forced claimed_at to null on every browser
--    insert), so the coach saw "Not signed in yet" and could mint a login link for them. A person who is signed in and creating their own profile HAS claimed it,
--    so the guard now stamps the time. Coach-created accounts are inserted by the server with claimed_at null and are not touched. People who already joined
--    this way and have signed in are backfilled.
-- Re-runnable.

-- 1 ------------------------------------------------------------------------------------------------------------------------------------------------------
create or replace function public.guard_membership_identity()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if coalesce(auth.role(), '') in ('authenticated', 'anon')
     and new.profile_id is distinct from old.profile_id then
    raise exception 'A membership cannot be handed to another person. Remove it and add them properly.' using errcode = '42501';
  end if;
  return new;
end;
$function$;

drop trigger if exists group_memberships_guard_identity on public.group_memberships;
create trigger group_memberships_guard_identity
  before update of profile_id on public.group_memberships
  for each row execute function public.guard_membership_identity();

-- 2 ------------------------------------------------------------------------------------------------------------------------------------------------------
create or replace function public.spend_coach_credits(p_coach_id uuid, p_cost integer)
returns table(spent boolean, new_balance integer, unlimited boolean)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_balance int;
  v_mode text;
begin
  if auth.role() is distinct from 'service_role' then
    if auth.uid() is null then
      raise exception 'Not authorized to spend these credits';
    elsif auth.uid() <> p_coach_id then
      raise exception 'Not authorized to spend these credits';
    end if;
  end if;
  if p_cost is null or p_cost < 0 then
    raise exception 'The cost must be zero or more';
  end if;

  select c.balance, c.ai_access_mode into v_balance, v_mode
  from public.coach_credits c
  where c.coach_id = p_coach_id
  for update;

  if v_mode = 'unlimited' then
    return query select true, coalesce(v_balance, 0), true;
    return;
  end if;

  v_balance := coalesce(v_balance, 0);

  if v_balance < p_cost then
    return query select false, v_balance, false;
    return;
  end if;

  update public.coach_credits c
  set balance = c.balance - p_cost, updated_at = now()
  where c.coach_id = p_coach_id
  returning c.balance into v_balance;

  return query select true, v_balance, false;
end;
$function$;

revoke all on function public.spend_coach_credits(uuid, integer) from public, anon, authenticated;
grant execute on function public.spend_coach_credits(uuid, integer) to service_role;

-- 3 ------------------------------------------------------------------------------------------------------------------------------------------------------
create or replace function public.spend_ai_action(p_coach_id uuid, p_action text, p_credit_cost integer, p_allowance integer)
returns table(spent boolean, source text, new_balance integer, allowance_remaining integer, unlimited boolean)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_balance int;
  v_mode text;
  v_period date;
  v_prog int;
  v_meal int;
  v_used int;
  v_allowance int;
  v_month date := (date_trunc('month', now() at time zone 'utc'))::date;
begin
  -- Server only: the route has already checked who is signed in and passes the coach's own id and the server's own numbers.
  if auth.role() is distinct from 'service_role' then
    raise exception 'Not authorized to spend these credits';
  end if;
  if p_coach_id is null or p_credit_cost is null or p_credit_cost < 0 or p_allowance is null or p_allowance < 0 then
    raise exception 'Invalid amount';
  end if;

  insert into public.coach_credits (coach_id) values (p_coach_id) on conflict (coach_id) do nothing;

  select c.balance, c.ai_access_mode, c.allowance_period, c.program_used, c.mealplan_used
    into v_balance, v_mode, v_period, v_prog, v_meal
  from public.coach_credits c
  where c.coach_id = p_coach_id
  for update;

  if v_period is distinct from v_month then
    v_prog := 0;
    v_meal := 0;
    update public.coach_credits
      set allowance_period = v_month, program_used = 0, mealplan_used = 0
      where coach_id = p_coach_id;
  end if;

  if v_mode = 'unlimited' then
    if p_action in ('program_generation', 'nutrition_plan', 'ci_overview') then
      insert into public.ai_charges (coach_id, action, source, credits_charged)
      values (p_coach_id, p_action, 'unlimited', 0);
    end if;
    return query select true, 'unlimited'::text, v_balance, 0, true;
    return;
  end if;

  v_used := case p_action
    when 'program_generation' then v_prog
    when 'nutrition_plan' then v_meal
    else null
  end;
  v_allowance := ceil(p_allowance * public.coach_ai_multiplier(p_coach_id));

  if v_used is not null and p_allowance > 0 and v_used < v_allowance then
    if p_action = 'program_generation' then
      update public.coach_credits set program_used = program_used + 1, updated_at = now() where coach_id = p_coach_id;
    else
      update public.coach_credits set mealplan_used = mealplan_used + 1, updated_at = now() where coach_id = p_coach_id;
    end if;
    insert into public.ai_charges (coach_id, action, source, credits_charged)
    values (p_coach_id, p_action, 'allowance', 0);
    return query select true, 'allowance'::text, v_balance, v_allowance - v_used - 1, false;
    return;
  end if;

  if v_balance < p_credit_cost then
    return query select false, 'none'::text, v_balance, 0, false;
    return;
  end if;

  update public.coach_credits
    set balance = balance - p_credit_cost, updated_at = now()
    where coach_id = p_coach_id
    returning balance into v_balance;

  insert into public.ai_charges (coach_id, action, source, credits_charged)
  values (p_coach_id, p_action, 'credits', p_credit_cost);

  return query select true, 'credits'::text, v_balance, 0, false;
end;
$function$;

revoke all on function public.spend_ai_action(uuid, text, integer, integer) from public, anon, authenticated;
grant execute on function public.spend_ai_action(uuid, text, integer, integer) to service_role;

-- 4 ------------------------------------------------------------------------------------------------------------------------------------------------------
drop policy if exists "athlete_exercise_videos_select_members" on storage.objects;
drop policy if exists "athlete_exercise_videos_select_own_or_coach" on storage.objects;
create policy "athlete_exercise_videos_select_own_or_coach" on storage.objects for select to authenticated
  using (
    bucket_id = 'athlete-exercise-videos'
    and (
      owner = (select auth.uid())
      or case when (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$' then public.is_group_coach(((storage.foldername(name))[1])::uuid) else false end
      or exists (select 1 from public.session_exercise_videos v where v.video_path = name and v.athlete_id = (select auth.uid()))
    )
  );

drop policy if exists "coach_video_checkins_select_members" on storage.objects;
drop policy if exists "coach_video_checkins_select_recipient_or_coach" on storage.objects;
create policy "coach_video_checkins_select_recipient_or_coach" on storage.objects for select to authenticated
  using (
    bucket_id = 'coach-video-checkins'
    and (
      case when (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$' then public.is_group_coach(((storage.foldername(name))[1])::uuid) else false end
      or (storage.foldername(name))[2] = (select auth.uid())::text
    )
  );

-- 5 ------------------------------------------------------------------------------------------------------------------------------------------------------
create or replace function public.guard_profile_sensitive_columns()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if auth.role() in ('authenticated', 'anon') then
    if tg_op = 'INSERT' then
      -- A person creating their own profile while signed in has claimed their account (coach-created accounts are inserted by the server, with claimed_at null).
      perform public.audit_blocked('profiles', new.id::text, jsonb_build_object('is_platform_admin', false, 'intake_required', true), to_jsonb(new), array['is_platform_admin', 'intake_required']);
      new.is_platform_admin := false;
      new.claimed_at := now();
      new.intake_required := true;
    else
      perform public.audit_blocked('profiles', old.id::text, to_jsonb(old), to_jsonb(new), array['intake_required', 'claimed_at']);
      new.intake_required := old.intake_required;
      new.claimed_at := old.claimed_at;
    end if;
  end if;
  return new;
end;
$function$;

-- Backfill: someone who joined by invite link before this fix has signed in (their sign-in time is on their login) but was never stamped. Accounts a coach made
-- for a client (placeholder address, never signed in) are left alone.
update public.profiles p
set claimed_at = coalesce(u.last_sign_in_at, p.created_at)
from auth.users u
where u.id = p.id
  and p.claimed_at is null
  and u.last_sign_in_at is not null
  and coalesce(u.email, '') not like '%@pending.invalid';
