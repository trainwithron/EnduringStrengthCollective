-- RELEASE H (REFUND FIX): ONE paste. Steps 38 in order, all or nothing.
--
-- Paste this whole file into the Supabase SQL editor and run it once. It replaces the separate precheck and apply files for these steps (they stay as the fallback).
-- Every check from each step's precheck is built in as a guard in front of that step. If any check is false, the run stops with a message that names the step and the
-- failed check, and NOTHING is kept, so a second run after a refusal is safe.
-- WHAT YOU SHOULD SEE: first "Success" for the transaction, then a result table with one row per step and in_place = true on every row.
-- ON ERROR: run   rollback;   once, copy the red text, send it to Spot. Do not run it again.
-- AFTER STEP 38: Nothing changes for normal use. The coach's 'This was wrong' button still refunds the latest charge once. The automatic refund when an AI meal-plan generation delivered nothing is now decided by the server (code in the same release): until that code is live the old browser call is refused, so a failed generation is not auto-refunded. Run it together with the release's code deploy.
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

-- ===== Release H (refund fix), step 38: 0293 a signed-in coach can no longer refund their own meal-plan or program charge by claiming the generation failed: that refund becomes server-only, and the coach's own 'This was wrong' button keeps working
do $g38$
declare
  failed text;
begin
  select string_agg(check_name, '; ') into failed from (
    values
      ('ai_charges, ai_output_refunds and coach_credits exist (0245 is applied)', to_regclass('public.ai_charges') is not null and to_regclass('public.ai_output_refunds') is not null and to_regclass('public.coach_credits') is not null),
      ('refund_coach_credit exists', to_regprocedure('public.refund_coach_credit(text, text, text, text)') is not null),
      ('0293 is not already applied (the server-only refund function is not there yet)', not exists (select 1 from pg_proc where proname = 'refund_coach_credit_for' and pronamespace = 'public'::regnamespace))
  ) as checks(check_name, ok) where not ok;
  if failed is not null then
    raise exception 'Release H (refund fix), step 38 (0293) cannot run: this step looks already applied, or the database is not in the state it expects. Failed checks: %. NOTHING was changed (the whole bundle is all or nothing). If an earlier step was applied by hand, use the single-step files for the rest, and send Spot this message.', failed;
  end if;
end
$g38$;

-- ====================================================================================================
-- migration 0293_refund_validator_failure_server_only.sql
-- ====================================================================================================

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
-- Honest scope: this REDUCES the self-refund, it does not close it. Paths that remain: generating slots long before pressing the charging button, and the coach's own
-- honor-system "This was wrong" flag. The real fix is the single server step in the Nutrition design (one request that generates, verifies, charges and refunds on its own
-- evidence).
-- Re-runnable.

create or replace function public.refund_coach_credit_for(
  p_coach_id uuid,
  p_action text,
  p_trigger text,
  p_reference_id text,
  p_reason text default null,
  p_charge_id uuid default null
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

  -- Only a meal-plan charge has an automatic refund.
  if p_trigger = 'auto_validator_failure' and p_action <> 'nutrition_plan' then
    raise exception 'No automatic refund exists for this action';
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
    and (p_charge_id is null or id = p_charge_id)
  order by created_at desc
  limit 1
  for update;

  if not found then
    return false;
  end if;

  -- The AUTOMATIC refund ("the generation delivered nothing") is checked here, under the lock on the very charge being refunded, so two concurrent requests cannot
  -- refund each other's charges: if the AI returned any usable suggestion from 30 minutes before this charge until now, the plan was delivered and the charge stands.
  -- (A coach may press the charging button after generating, so the look-back starts before the charge.)
  if p_trigger = 'auto_validator_failure' then
    if exists (
      select 1 from public.ai_usage_log
      where user_id = v_coach_id
        and feature = 'meal_plan_slot_delivered'
        and created_at >= v_charge.created_at - interval '30 minutes'
    ) then
      return false;
    end if;
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

revoke all on function public.refund_coach_credit_for(uuid, text, text, text, text, uuid) from public, anon, authenticated;
grant execute on function public.refund_coach_credit_for(uuid, text, text, text, text, uuid) to service_role;

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

commit;

-- Read-only result (after the commit): every row must say in_place = true.
select step, what, in_place from (
  select 'step 38 (0293)' as step, '0293 a signed-in coach can no longer refund their own meal-plan or program charge by claiming the generation failed: that refund becomes server-only' as what, not ((not exists (select 1 from pg_proc where proname = 'refund_coach_credit_for' and pronamespace = 'public'::regnamespace))) as in_place
) as result order by step;
