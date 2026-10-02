-- AI Output Refund Policy (ai_output_foolproofing_and_quality_
-- assurance_idea.md's follow-up) — investigated the real codebase
-- first: the three named deterministic guards (numeral guard, name
-- guard, the briefing items' fact-vs-question CHECK constraint) only
-- ever run on free/unmetered features (CI chat, the coach-briefing
-- cron, Spotter synthesis) — neither credit-gated AI action
-- (program_generation, nutrition_plan) uses them. program_generation's
-- own real guards (isValidRow row-shape check, the injury-
-- considerations guard) already run BEFORE the credit spend and reject
-- outright with no charge — so there's nothing to refund there today,
-- by design. nutrition_plan's /api/ai/meal-plan-credit-charge is the
-- one real gap: it charges a flat 3 credits up front, independent of
-- whether the per-meal AI calls that follow actually produce anything
-- (each one already silently falls back to non-AI options on its own
-- failure, per meal-plan-generator.tsx's existing runFallback). This
-- migration builds the real refund mechanism for that case, plus the
-- unconditional coach-facing "This was wrong" flag for either action.

-- A refund is always linked to one real credit movement — distinct
-- from credit_purchases/membership rows, which are purchase records,
-- not mid-balance adjustments. reference_id ties one refund to one
-- specific generation attempt (a program id once created, or a
-- client-generated one-time token for a charge that produced nothing
-- durable to point at) so the same generation can never be refunded
-- twice.
create table public.ai_output_refunds (
  id uuid primary key default uuid_generate_v4(),
  coach_id uuid not null references public.profiles(id) on delete cascade,
  action text not null check (action in ('program_generation', 'nutrition_plan')),
  credits_refunded int not null check (credits_refunded > 0),
  trigger text not null check (trigger in ('auto_validator_failure', 'coach_flagged')),
  reason text,
  reference_id text not null,
  created_at timestamptz not null default now(),
  unique (coach_id, reference_id)
);
create index ai_output_refunds_coach_id_idx on public.ai_output_refunds(coach_id);

alter table public.ai_output_refunds enable row level security;
create policy "ai_output_refunds_select_own" on public.ai_output_refunds for select
  to authenticated using (coach_id = (select auth.uid()));
-- No authenticated insert/update/delete policy at all — every row is
-- written exclusively by the two security-definer functions below,
-- same "no direct table access, only through a narrow RPC" discipline
-- as spend_coach_credits (0220).

-- Always derives the coach from auth.uid() directly (never a p_coach_id
-- parameter) — avoids entirely the class of NULL-unsafe-comparison bug
-- already found and fixed once tonight elsewhere in this same credit
-- system. The credit amount is hardcoded per action here, never trusted
-- from the caller, so a coach can never request more than the real
-- cost of that action — mirrors AI_ACTION_COSTS in lib/coach-credits.ts;
-- keep both in sync if either action's price ever changes. The
-- (coach_id, reference_id) unique constraint is the real guard against
-- refunding the same generation twice (a coach spamming "This was
-- wrong" on the same output); this function just turns that into a
-- clean `false` return instead of a raw constraint-violation error.
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

  -- Unlimited coaches never had a credit decremented to give back —
  -- still logged above (a real audit trail of how often generations
  -- get flagged/fail, regardless of plan), but the balance itself is
  -- only touched for a metered coach.
  update public.coach_credits
  set balance = balance + v_credits, updated_at = now()
  where coach_id = v_coach_id and ai_access_mode is distinct from 'unlimited';

  return true;
end;
$$;

-- The optional, separate "why" a coach can attach after the refund
-- already fired instantly and unconditionally (ai_output_
-- foolproofing_and_quality_assurance_idea.md's explicit requirement —
-- the refund must never wait on this). Only ever touches a refund row
-- the calling coach themselves created.
create or replace function public.attach_refund_reason(p_reference_id text, p_reason text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_coach_id uuid := auth.uid();
  v_updated int;
begin
  if v_coach_id is null then
    raise exception 'Not signed in';
  end if;

  update public.ai_output_refunds
  set reason = p_reason
  where coach_id = v_coach_id and reference_id = p_reference_id;

  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$$;
