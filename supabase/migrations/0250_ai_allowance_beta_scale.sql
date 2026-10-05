-- AI allowance guardrails for free beta orgs, a sensible floor for coaches with very few clients, and a cap that
-- counts failed attempts.
--
-- 1. organization_billing.ai_allowance_scale: a per-org multiplier on the standard allowance, set by the platform
--    admin. Free-access (billing_exempt) orgs with no value set use a default scale of 0.3, which is about 30 program
--    generations and 60 meal plans a month instead of 100 and 200 per 100-client step.
-- 2. coach_ai_multiplier(coach): the one number every AI limit is scaled by.
--      - an org with an explicit scale: that scale
--      - else a free-access org: 0.3
--      - else the client count: under 25 clients a prorated share of one step (never below a quarter step, so a
--        coach with no clients yet can still build programs), 25 to 100 clients one step, then one step per 100.
--    lib/ai-usage.ts mirrors this (aiMultiplier); keep both in sync.
-- 3. spend_ai_action and reserve_ai_call use the multiplier instead of the plain step count. reserve_ai_call already
--    counts EVERY logged call this month (successful or failed), so giving program_generation a monthly ceiling
--    means failed and truncated generations count toward a cap even though only a successful one is charged.
--
-- Requires 0245 (spend_ai_action there records charges). Same function names and signatures as before.

alter table public.organization_billing
  add column if not exists ai_allowance_scale numeric check (ai_allowance_scale is null or ai_allowance_scale >= 0);

create or replace function public.coach_ai_multiplier(p_coach_id uuid)
returns numeric
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_exempt boolean;
  v_scale numeric;
  v_clients int;
begin
  select coalesce(ob.billing_exempt, false), ob.ai_allowance_scale
    into v_exempt, v_scale
  from public.organization_memberships om
  left join public.organization_billing ob on ob.organization_id = om.organization_id
  where om.profile_id = p_coach_id
  order by coalesce(ob.billing_exempt, false) asc
  limit 1;

  if v_scale is not null then
    return v_scale;
  end if;
  if coalesce(v_exempt, false) then
    return 0.3;
  end if;

  select count(distinct a.profile_id) into v_clients
  from public.group_memberships c
  join public.group_memberships a on a.group_id = c.group_id
  where c.profile_id = p_coach_id
    and c.role = 'coach'
    and a.role = 'athlete'
    and a.membership_type = 'training';

  if v_clients < 25 then
    return greatest(0.25, v_clients / 25.0);
  end if;
  return greatest(1, ceil(v_clients::numeric / 100));
end;
$$;

create or replace function public.reserve_ai_call(
  p_user_id uuid,
  p_coach_id uuid,
  p_feature text,
  p_enforce boolean,
  p_burst_limit int,
  p_burst_features text[],
  p_monthly_ceiling int default null -- per full 100-client step, scaled by coach_ai_multiplier
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
      -- Every call logged this month counts, whatever its outcome (started, ok, truncated, error).
      select count(*) into v_count
      from public.ai_usage_log
      where coach_id = v_coach and feature = p_feature and created_at >= v_month_start;
      if v_count >= ceil(p_monthly_ceiling * public.coach_ai_multiplier(v_coach)) then
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
