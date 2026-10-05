-- AI cost control. $50/mo coach plan with AI included only stays
-- profitable if usage is bounded, and until now nothing recorded or
-- limited it: callClaude discarded the response's token usage and no
-- route had a rate limit or spend cap.
--
-- 1. ai_usage_log — one row per Claude call (model + input/output
--    tokens + feature + who), so real cost can be computed per coach
--    (and later billed as month-end overage). Server-written only.
-- 2. coach_credits gains monthly allowance counters (calendar month,
--    UTC): the included program generations / meal plans.
-- 3. reserve_ai_call — atomic burst limit + monthly per-feature ceiling,
--    reserving the log row at call START so concurrent requests can't
--    all slip past before any finishes (generations run up to a minute).
-- 4. spend_ai_action — spends the monthly allowance first, then credits,
--    under the same row lock pattern as spend_coach_credits (0220).
-- 5. refund_coach_credit — now restores an allowance slot instead of
--    minting credits when the refunded generation was allowance-covered.

create table public.ai_usage_log (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references public.profiles(id) on delete set null,   -- who triggered it
  coach_id uuid references public.profiles(id) on delete set null,  -- whose bill it lands on
  feature text not null,
  model text,
  input_tokens int,
  output_tokens int,
  status text not null default 'started' check (status in ('started', 'ok', 'truncated', 'error')),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index ai_usage_log_user_created_idx on public.ai_usage_log (user_id, created_at desc);
create index ai_usage_log_coach_feature_created_idx on public.ai_usage_log (coach_id, feature, created_at desc);
-- RLS on with NO policies: only the service role (which bypasses RLS)
-- ever reads or writes this table.
alter table public.ai_usage_log enable row level security;

alter table public.coach_credits
  add column allowance_period date,
  add column program_used int not null default 0,
  add column mealplan_used int not null default 0;

create or replace function public.reserve_ai_call(
  p_user_id uuid,
  p_coach_id uuid,
  p_feature text,
  p_enforce boolean,
  p_burst_limit int,
  p_burst_features text[],
  p_monthly_ceiling int default null
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
  -- Null-safe on purpose (same lesson as adjust_coach_credits, 0220).
  if auth.role() is distinct from 'service_role' then
    raise exception 'Not authorized';
  end if;

  -- Billing coach: the caller themselves if they coach anywhere, else
  -- the coach of a group they belong to.
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
    -- Serialize this actor's reservations so the count-then-insert
    -- below can't be raced by a concurrent request.
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
      if v_count >= p_monthly_ceiling then
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
  p_allowance int
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
  v_month date := (date_trunc('month', now() at time zone 'utc'))::date;
begin
  if auth.uid() is null or auth.uid() is distinct from p_coach_id then
    raise exception 'Not authorized to spend these credits';
  end if;

  -- A coach with no row yet (never granted) is metered at balance 0 —
  -- create it so the allowance counters have somewhere to live.
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

  if v_used is not null and p_allowance > 0 and v_used < p_allowance then
    if p_action = 'program_generation' then
      update public.coach_credits set program_used = program_used + 1, updated_at = now() where coach_id = p_coach_id;
    else
      update public.coach_credits set mealplan_used = mealplan_used + 1, updated_at = now() where coach_id = p_coach_id;
    end if;
    return query select true, 'allowance'::text, v_balance, p_allowance - v_used - 1, false;
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

-- Same function as 0223 plus: restore an allowance slot rather than
-- minting credits when this month's counter shows the refunded
-- generation was (or could have been) allowance-covered. Approximation
-- stated plainly: if a coach has used their whole allowance and then paid
-- credits for one more, refunding that one hands back an allowance slot
-- (equal value: they can regenerate for free) rather than credits.
create or replace function public.refund_coach_credit(
  p_action text,
  p_trigger text,
  p_reference_id text,
  p_reason text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_coach_id uuid := auth.uid();
  v_credits int;
  v_mode text;
  v_period date;
  v_prog int;
  v_meal int;
  v_month date := (date_trunc('month', now() at time zone 'utc'))::date;
begin
  if v_coach_id is null then
    raise exception 'Not signed in';
  end if;
  if p_trigger not in ('auto_validator_failure', 'coach_flagged') then
    raise exception 'Invalid trigger';
  end if;
  if p_reference_id is null or length(trim(p_reference_id)) = 0 then
    raise exception 'A reference id is required';
  end if;

  v_credits := case p_action
    when 'program_generation' then 3
    when 'nutrition_plan' then 3
    else null
  end;
  if v_credits is null then
    raise exception 'Invalid action';
  end if;

  if exists (
    select 1 from public.ai_output_refunds
    where coach_id = v_coach_id and reference_id = p_reference_id
  ) then
    return false;
  end if;

  insert into public.ai_output_refunds (coach_id, action, credits_refunded, trigger, reason, reference_id)
  values (v_coach_id, p_action, v_credits, p_trigger, p_reason, p_reference_id);

  select c.ai_access_mode, c.allowance_period, c.program_used, c.mealplan_used
    into v_mode, v_period, v_prog, v_meal
  from public.coach_credits c
  where c.coach_id = v_coach_id
  for update;

  if v_mode is null or v_mode = 'unlimited' then
    return true; -- logged; nothing was decremented to give back
  end if;

  if v_period = v_month and p_action = 'program_generation' and v_prog > 0 then
    update public.coach_credits set program_used = program_used - 1, updated_at = now() where coach_id = v_coach_id;
  elsif v_period = v_month and p_action = 'nutrition_plan' and v_meal > 0 then
    update public.coach_credits set mealplan_used = mealplan_used - 1, updated_at = now() where coach_id = v_coach_id;
  else
    update public.coach_credits set balance = balance + v_credits, updated_at = now() where coach_id = v_coach_id;
  end if;

  return true;
end;
$$;
