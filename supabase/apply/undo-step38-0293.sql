-- UNDO for step 38 (0293). Only if refunds misbehave after step 38. Puts refund_coach_credit back as it was (the browser can name either trigger again, which re-opens the self-refund) and removes the server-only refund function.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."   Then tell Spot, and do not run the step again until Spot says why it failed.
begin;
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
drop function if exists public.refund_coach_credit_for(uuid, text, text, text, text, uuid);
commit;
