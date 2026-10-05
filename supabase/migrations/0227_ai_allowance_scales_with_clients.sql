-- The monthly AI allowance and the per-meal-call ceiling scale with a
-- coach's client count in 100-client steps (the plan's own pricing
-- steps): a coach with 100 clients legitimately generates roughly one
-- program per client per month, so a flat number is too tight.
--
-- Pure CREATE OR REPLACE, same names/argument lists/return shapes as
-- 0226 — nothing dropped. The two parameters whose meaning changes keep
-- their names (p_allowance, p_monthly_ceiling) and are now PER
-- 100-CLIENT STEP; the multiplier is computed here from the real client
-- count, never passed in, so a caller can't spoof it and a coach who adds
-- clients mid-month gets the larger allowance immediately. The 100 step
-- size lives in coach_client_steps() below and is mirrored by
-- CLIENT_STEP_SIZE in lib/ai-usage.ts (keep both in sync).

-- Distinct training-membership athletes across every group this person
-- coaches. Step = max(1, ceil(clients / 100)).
create or replace function public.coach_client_steps(p_coach_id uuid)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select greatest(1, ceil(count(distinct a.profile_id)::numeric / 100)::int)
  from public.group_memberships c
  join public.group_memberships a on a.group_id = c.group_id
  where c.profile_id = p_coach_id
    and c.role = 'coach'
    and a.role = 'athlete'
    and a.membership_type = 'training';
$$;

create or replace function public.reserve_ai_call(
  p_user_id uuid,
  p_coach_id uuid,
  p_feature text,
  p_enforce boolean,
  p_burst_limit int,
  p_burst_features text[],
  p_monthly_ceiling int default null -- per 100-client step
)
returns table(log_id uuid, denied_reason text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_coach uuid := p_coach_id;
  v_count int;
  v_id uuid;
  v_month_start timestamptz := (date_trunc('month', now() at time zone 'utc')) at time zone 'utc';
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Not authorized';
  end if;

  if v_coach is null and p_user_id is not null then
    if exists (select 1 from public.group_memberships where profile_id = p_user_id and role = 'coach') then
      v_coach := p_user_id;
    else
      select gm.profile_id into v_coach
      from public.group_memberships gm
      where gm.role = 'coach'
        and gm.group_id in (select group_id from public.group_memberships where profile_id = p_user_id)
      order by gm.joined_at
      limit 1;
    end if;
  end if;

  if p_enforce and p_user_id is not null then
    perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

    select count(*) into v_count
    from public.ai_usage_log
    where user_id = p_user_id
      and created_at > now() - interval '1 minute'
      and feature = any(p_burst_features);
    if v_count >= p_burst_limit then
      return query select null::uuid, 'burst'::text;
      return;
    end if;

    if p_monthly_ceiling is not null and v_coach is not null then
      select count(*) into v_count
      from public.ai_usage_log
      where coach_id = v_coach and feature = p_feature and created_at >= v_month_start;
      if v_count >= p_monthly_ceiling * public.coach_client_steps(v_coach) then
        return query select null::uuid, 'monthly_ceiling'::text;
        return;
      end if;
    end if;
  end if;

  insert into public.ai_usage_log (user_id, coach_id, feature)
  values (p_user_id, v_coach, p_feature)
  returning id into v_id;

  return query select v_id, null::text;
end;
$$;

create or replace function public.spend_ai_action(
  p_coach_id uuid,
  p_action text,
  p_credit_cost int,
  p_allowance int -- per 100-client step
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
    return query select true, 'unlimited'::text, v_balance, 0, true;
    return;
  end if;

  v_used := case p_action
    when 'program_generation' then v_prog
    when 'nutrition_plan' then v_meal
    else null
  end;
  v_allowance := p_allowance * public.coach_client_steps(p_coach_id);

  if v_used is not null and p_allowance > 0 and v_used < v_allowance then
    if p_action = 'program_generation' then
      update public.coach_credits set program_used = program_used + 1, updated_at = now() where coach_id = p_coach_id;
    else
      update public.coach_credits set mealplan_used = mealplan_used + 1, updated_at = now() where coach_id = p_coach_id;
    end if;
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

  return query select true, 'credits'::text, v_balance, 0, false;
end;
$$;
