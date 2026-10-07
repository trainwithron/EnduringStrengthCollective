-- UNDO for step 35 (0290). Only if something misbehaves after step 35. Puts back the old functions, grants and the two wider video policies. It does NOT un-stamp the people who were marked as signed in (that was a correction of wrong data).
-- WHAT YOU SHOULD SEE: "Success. No rows returned."   Then tell Spot, and do not run the step again until Spot says why it failed.
begin;
drop trigger if exists group_memberships_guard_identity on public.group_memberships;
drop function if exists public.guard_membership_identity();
create or replace function public.spend_coach_credits(p_coach_id uuid, p_cost integer)
returns table(spent boolean, new_balance integer, unlimited boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance int;
  v_mode text;
begin
  if auth.uid() is null then
    raise exception 'Not authorized to spend these credits';
  elsif auth.uid() <> p_coach_id then
    raise exception 'Not authorized to spend these credits';
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
$$;
grant execute on function public.spend_coach_credits(uuid, integer) to authenticated, service_role;
create or replace function public.spend_ai_action(
  p_coach_id uuid,
  p_action text,
  p_credit_cost int,
  p_allowance int -- per full 100-client step
)
returns table(spent boolean, source text, new_balance int, allowance_remaining int, unlimited boolean)
language plpgsql
security definer
set search_path = public
as $$
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
  if auth.uid() is null or auth.uid() is distinct from p_coach_id then
    raise exception 'Not authorized to spend these credits';
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
$$;
grant execute on function public.spend_ai_action(uuid, text, integer, integer) to authenticated, service_role;
drop policy if exists "athlete_exercise_videos_select_own_or_coach" on storage.objects;
drop policy if exists "athlete_exercise_videos_select_members" on storage.objects;
create policy "athlete_exercise_videos_select_members" on storage.objects for select to authenticated using (bucket_id = 'athlete-exercise-videos' and public.is_group_member(((storage.foldername(name))[1])::uuid));
drop policy if exists "coach_video_checkins_select_recipient_or_coach" on storage.objects;
drop policy if exists "coach_video_checkins_select_members" on storage.objects;
create policy "coach_video_checkins_select_members" on storage.objects for select to authenticated using (bucket_id = 'coach-video-checkins' and public.is_group_member(((storage.foldername(name))[1])::uuid));
create or replace function public.guard_profile_sensitive_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() in ('authenticated', 'anon') then
    if tg_op = 'INSERT' then
      perform public.audit_blocked('profiles', new.id::text, jsonb_build_object('is_platform_admin', false, 'claimed_at', null, 'intake_required', true), to_jsonb(new), array['is_platform_admin', 'claimed_at', 'intake_required']);
      new.is_platform_admin := false;
      new.claimed_at := null;
      new.intake_required := true;
    else
      perform public.audit_blocked('profiles', old.id::text, to_jsonb(old), to_jsonb(new), array['intake_required', 'claimed_at']);
      new.intake_required := old.intake_required;
      new.claimed_at := old.claimed_at;
    end if;
  end if;
  return new;
end;
$$;
commit;
