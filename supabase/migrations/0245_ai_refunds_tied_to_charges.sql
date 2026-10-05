-- AI refunds must be tied to a charge that actually happened.
--
-- refund_coach_credit (0223/0226) checked the reference id was new, then handed back credits (or an allowance
-- slot) without ever checking that anything had been charged. Any coach could POST /api/ai/refund-credit with a
-- fresh referenceId again and again and mint 3 credits each time.
--
-- Fix: every successful spend_ai_action now records a row in ai_charges, and a refund must consume exactly one
-- unrefunded charge of that action from the last 24 hours, once. The amount handed back is what that charge
-- actually took, not a number the caller names.
--
-- Compatibility: both functions keep their exact signatures, so code that is already deployed keeps working with
-- no change. The one visible difference for it: a refund with no matching recorded charge returns false (the
-- same answer the app already shows for "already refunded"). Charges made before this migration was applied were
-- not recorded, so a "This was wrong" flag on a generation from before then returns false instead of refunding.

create table if not exists public.ai_charges (
  id uuid primary key default uuid_generate_v4(),
  coach_id uuid not null references public.profiles(id) on delete cascade,
  action text not null check (action in ('program_generation', 'nutrition_plan', 'ci_overview')),
  -- How this charge was covered: this month's included generations, credits, or an unlimited plan.
  source text not null check (source in ('allowance', 'credits', 'unlimited')),
  credits_charged int not null default 0 check (credits_charged >= 0),
  created_at timestamptz not null default now(),
  refunded_at timestamptz
);
create index if not exists ai_charges_coach_action_idx on public.ai_charges (coach_id, action, created_at desc);

-- No policies: only the security-definer functions below read or write it.
alter table public.ai_charges enable row level security;

alter table public.ai_output_refunds add column if not exists charge_id uuid references public.ai_charges(id) on delete set null;

-- Same function as 0227, plus recording the charge.
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
  v_allowance := p_allowance * public.coach_client_steps(p_coach_id);

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

-- Same signature as 0226. Now: find the newest unrefunded charge of this action in the last 24 hours (locked, so
-- two refunds racing for one charge cannot both win), mark it refunded, and give back exactly what it took.
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
  v_charge public.ai_charges%rowtype;
  v_nominal int;
  v_month date := (date_trunc('month', now() at time zone 'utc'))::date;
  v_period date;
  v_prog int;
  v_meal int;
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

  v_nominal := case p_action
    when 'program_generation' then 3
    when 'nutrition_plan' then 3
    else null
  end;
  if v_nominal is null then
    raise exception 'Invalid action';
  end if;

  -- The same reference id never refunds twice.
  if exists (
    select 1 from public.ai_output_refunds
    where coach_id = v_coach_id and reference_id = p_reference_id
  ) then
    return false;
  end if;

  -- Serialize this coach's refunds so the same charge cannot be claimed by two requests at once.
  perform 1 from public.coach_credits where coach_id = v_coach_id for update;

  select * into v_charge
  from public.ai_charges
  where coach_id = v_coach_id
    and action = p_action
    and refunded_at is null
    and created_at > now() - interval '24 hours'
  order by created_at desc
  limit 1
  for update;

  if not found then
    return false; -- nothing was charged that could be refunded
  end if;

  update public.ai_charges set refunded_at = now() where id = v_charge.id;

  insert into public.ai_output_refunds (coach_id, action, credits_refunded, trigger, reason, reference_id, charge_id)
  values (
    v_coach_id, p_action,
    case when v_charge.credits_charged > 0 then v_charge.credits_charged else v_nominal end,
    p_trigger, p_reason, p_reference_id, v_charge.id
  );

  if v_charge.source = 'unlimited' then
    return true; -- logged; nothing was decremented to give back
  end if;

  if v_charge.source = 'credits' then
    update public.coach_credits
      set balance = balance + v_charge.credits_charged, updated_at = now()
      where coach_id = v_coach_id;
    return true;
  end if;

  -- Covered by this month's included generations: restore the slot, but only if that month's counter is still
  -- the one the charge came out of.
  select c.allowance_period, c.program_used, c.mealplan_used
    into v_period, v_prog, v_meal
  from public.coach_credits c
  where c.coach_id = v_coach_id;

  if v_period = v_month and date_trunc('month', v_charge.created_at at time zone 'utc')::date = v_month then
    if p_action = 'program_generation' and v_prog > 0 then
      update public.coach_credits set program_used = program_used - 1, updated_at = now() where coach_id = v_coach_id;
    elsif p_action = 'nutrition_plan' and v_meal > 0 then
      update public.coach_credits set mealplan_used = mealplan_used - 1, updated_at = now() where coach_id = v_coach_id;
    end if;
  end if;

  return true;
end;
$$;

-- attach_refund_reason (0223) is unchanged: it only ever touches a refund row the caller created.
