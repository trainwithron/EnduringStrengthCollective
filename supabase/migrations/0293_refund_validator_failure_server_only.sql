-- A coach could refund their own meal-plan charge while keeping the plan.
--
-- refund_coach_credit(action, trigger, reference_id, reason) is callable by any signed-in user and TRUSTED the trigger the caller named. The 'auto_validator_failure'
-- trigger means "the AI generation did not deliver anything usable", which only the server can know; but the browser could send it for any generation, so a coach
-- could generate a meal plan (3 credits), keep the plan, and call it with 'auto_validator_failure' to take the credit back. 0245 already made a refund consume one
-- real charge from the last 24 hours and gave one refund per charge, so the exposure is the price of a plan each time, but it is a real self-refund.
--
-- Now:
--   * refund_coach_credit_for(coach, action, trigger, reference, reason) holds the whole refund logic, for either trigger, for a named coach. It is closed to signed-in
--     users and the public: only the server (service role) can run it, after it has checked its own evidence that the generation delivered nothing.
--   * refund_coach_credit(action, trigger, reference, reason) keeps its signature and its grants (CREATE OR REPLACE; not dropped, so its permissions are untouched) and
--     is now only the coach's own "This was wrong" button: it accepts the 'coach_flagged' trigger only and runs the same logic for the signed-in coach.
-- The 'coach_flagged' button stays honest-user feedback by design (a person tapping "this output was wrong"); the one-refund-per-charge rules are unchanged.
-- Re-runnable.

create or replace function public.refund_coach_credit_for(
  p_coach_id uuid,
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
  v_coach_id uuid := p_coach_id;
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

  if exists (
    select 1 from public.ai_output_refunds
    where coach_id = v_coach_id and reference_id = p_reference_id
  ) then
    return false;
  end if;

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
    return false;
  end if;

  update public.ai_charges set refunded_at = now() where id = v_charge.id;

  insert into public.ai_output_refunds (coach_id, action, credits_refunded, trigger, reason, reference_id, charge_id)
  values (
    v_coach_id, p_action,
    case when v_charge.credits_charged > 0 then v_charge.credits_charged else v_nominal end,
    p_trigger, p_reason, p_reference_id, v_charge.id
  );

  if v_charge.source = 'unlimited' then
    return true;
  end if;

  if v_charge.source = 'credits' then
    update public.coach_credits
      set balance = balance + v_charge.credits_charged, updated_at = now()
      where coach_id = v_coach_id;
    return true;
  end if;

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

revoke all on function public.refund_coach_credit_for(uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.refund_coach_credit_for(uuid, text, text, text, text) to service_role;

-- Same signature and grants as 0245 (CREATE OR REPLACE keeps them): now only the coach's own flag.
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
begin
  if v_coach_id is null then
    raise exception 'Not signed in';
  end if;
  -- "The generation did not deliver" is something only the server can know, so a signed-in caller can never claim it.
  if p_trigger is distinct from 'coach_flagged' then
    raise exception 'Invalid trigger';
  end if;
  return public.refund_coach_credit_for(v_coach_id, p_action, 'coach_flagged', p_reference_id, p_reason);
end;
$$;
