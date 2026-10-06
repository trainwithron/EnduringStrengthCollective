-- STEP 01: 0249 coach completion message, 0250 AI allowance scaling, 0254 client tag write rules, 0240 guide dismissal, 0241 program label and order
--
-- Run apply-precheck first (every row ok = true). Then paste THIS file and run it once.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."
-- AFTERWARDS: Nothing visible changes at once. Coaches' AI allowances now scale with client count (free-access orgs get 0.3); only an owner or admin can create or change client tags; clients can pick a program label.
-- ON ERROR: it is all or nothing, so nothing was applied. Run   rollback;   once, copy the red error text, and send it back. Do not run the file again.
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

do $guard$
begin
  if not ((not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'client_tags' and policyname = 'client_tags_insert_owner_admin'))) then
    raise exception 'Step 01 (0249-0250-0254-0240-0241) looks already applied, or the database is not in the state it expects. Nothing was changed. Run the precheck file and send Spot the result.';
  end if;
end
$guard$;

-- ====================================================================================================
-- migration 0249_coach_completion_message.sql
-- ====================================================================================================

-- A coach's own words for a client who has just finished a workout, shown on the client's post-workout card
-- ("From your coach"). Optional; without it the card uses a warm default written in the coach's voice.
-- Added to coach_profiles, which the coach already edits from their Home.
alter table public.coach_profiles
  add column if not exists completion_message text
    check (completion_message is null or length(completion_message) <= 280);

-- ====================================================================================================
-- migration 0250_ai_allowance_beta_scale.sql
-- ====================================================================================================

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

-- ====================================================================================================
-- migration 0254_client_tag_write_rules.sql
-- ====================================================================================================

-- Client tags: who may change what.
--
-- 0202 let ANY member of an organization create, rename, delete and flag tags, and assign any tag to any person, through
-- "for all" policies. The tag that gates revenue splitting decides which clients' payments are split with the owner, so a
-- trainer could flip that flag or tag/untag clients to change who gets paid, though the screens say only owners and admins
-- manage tags. Now, enforced in the database:
--   * only an owner or admin of the organization creates, edits or deletes tags (including the revenue-split flag);
--   * any member may still see tags, and may assign or remove a tag that does NOT gate revenue;
--   * assigning or removing the revenue-splitting tag needs an owner or admin;
--   * the person being tagged must belong to a group in that organization.

create or replace function public.is_org_owner_or_admin(target_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.organization_memberships om
    where om.organization_id = target_org_id
      and om.profile_id = (select auth.uid())
      and om.role in ('owner', 'admin')
  );
$$;

-- Is this person a client in some group of this organization? Security definer because the owner or admin who assigns a tag is often not a
-- member of that group, so they cannot see its memberships under their own row security. Only answers for organization members.
create or replace function public.athlete_in_org(target_athlete_id uuid, target_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_org_member(target_org_id)
    and exists (
      select 1 from public.group_memberships gm
      join public.groups g on g.id = gm.group_id
      where gm.profile_id = target_athlete_id
        and g.organization_id = target_org_id
    );
$$;

drop policy if exists "client_tags_write_org_member" on public.client_tags;
create policy "client_tags_insert_owner_admin" on public.client_tags for insert
  to authenticated with check (public.is_org_owner_or_admin(organization_id));
create policy "client_tags_update_owner_admin" on public.client_tags for update
  to authenticated using (public.is_org_owner_or_admin(organization_id)) with check (public.is_org_owner_or_admin(organization_id));
create policy "client_tags_delete_owner_admin" on public.client_tags for delete
  to authenticated using (public.is_org_owner_or_admin(organization_id));

drop policy if exists "client_tag_assignments_write_org_member" on public.client_tag_assignments;

create policy "client_tag_assignments_insert" on public.client_tag_assignments for insert
  to authenticated
  with check (
    exists (
      select 1 from public.client_tags t
      where t.id = tag_id
        and public.is_org_member(t.organization_id)
        and (not t.gates_revenue_split or public.is_org_owner_or_admin(t.organization_id))
        and public.athlete_in_org(client_tag_assignments.athlete_id, t.organization_id)
    )
  );

create policy "client_tag_assignments_delete" on public.client_tag_assignments for delete
  to authenticated
  using (
    exists (
      select 1 from public.client_tags t
      where t.id = tag_id
        and public.is_org_member(t.organization_id)
        and (not t.gates_revenue_split or public.is_org_owner_or_admin(t.organization_id))
    )
  );

-- ====================================================================================================
-- migration 0240_profile_guide_dismissed.sql
-- ====================================================================================================

-- First-run guide ("Get set up": add to home screen, turn on notifications).
-- When a client taps "Not now" the dismissal is stored here so it follows them
-- to another phone. Until this column exists the card falls back to a
-- per-device flag, so nothing breaks if the app deploys first.
alter table public.profiles
  add column if not exists guide_dismissed_at timestamptz;

-- ====================================================================================================
-- migration 0241_program_label_and_order.sql
-- ====================================================================================================

-- Several programs can be active for one client at once (a main program, a
-- mobility program on off days, a warm-up flow). These two columns let the
-- coach name each one's role and say what order they appear in on the
-- athlete's Today view. Both are optional: with neither set, programs show
-- under their own name, oldest first, exactly as before.
alter table public.programs
  add column if not exists label text,
  add column if not exists sort_order integer;

comment on column public.programs.label is
  'Short role shown to the athlete: Main, Mobility, Warm-up, Conditioning, or anything the coach types.';
comment on column public.programs.sort_order is
  'Lower numbers show first on the athlete Today view. Null sorts after numbered programs, oldest first.';

commit;
