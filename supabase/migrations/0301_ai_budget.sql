-- AI budget (nutrition tracking, phase 1). One monthly AI budget per ORGANIZATION (a solo coach's organization is just them), measured in real cost: every AI call is already logged
-- with its model and token counts (ai_usage_log, 0226); the app prices those tokens and compares the month's total with the organization's budget. A gym with several trainers
-- shares one pool. This migration adds the pieces the database has to hold. All of them are server-only: the usage log and the budget helpers are not readable from the app.
--
--  * ai_org_summary(org): how big the organization is for the budget: its client count, how many coaches it has, whether it is free-access (beta) and its own scale, and whether its
--    owner is an internal unlimited account.
--  * ai_org_month_usage(org, since): this month's AI use for every coach in the organization, summed by model (input tokens, output tokens, calls), counting only calls that
--    finished (ok, or cut off after producing output); a failed call is never counted. Priced in the app (lib/ai-budget.ts), so a price change never needs a database change.
--  * ai_budget_topups: money added to an organization's budget for one month by a paid top-up pack (written by the payment webhook, once per payment).
--  * ai_budget_notices: one row per organization, month and level ('low' = about 80 percent of the included budget, 'balance' = the included budget is used up and the top-up balance has started paying, 'out' = everything used up) so the owner and the coach are told ONCE, not on every request.
-- Nothing here changes who can read or write anything else. Re-runnable.

create or replace function public.ai_org_summary(p_org_id uuid)
returns table(clients integer, coaches integer, billing_exempt boolean, ai_scale numeric, owner_unlimited boolean)
language sql
stable
security definer
set search_path = public
as $function$
  select
    (select count(distinct a.profile_id)::integer
       from public.group_memberships a
       join public.groups g on g.id = a.group_id
      where g.organization_id = p_org_id and a.role = 'athlete' and a.membership_type = 'training'),
    greatest(1, (select count(distinct c.profile_id)::integer
       from public.group_memberships c
       join public.groups g on g.id = c.group_id
      where g.organization_id = p_org_id and c.role = 'coach')),
    coalesce((select ob.billing_exempt from public.organization_billing ob where ob.organization_id = p_org_id), false),
    (select ob.ai_allowance_scale from public.organization_billing ob where ob.organization_id = p_org_id),
    coalesce((select cc.ai_access_mode = 'unlimited'
                from public.organizations o
                join public.coach_credits cc on cc.coach_id = o.owner_id
               where o.id = p_org_id), false);
$function$;
revoke all on function public.ai_org_summary(uuid) from public, anon, authenticated;
grant execute on function public.ai_org_summary(uuid) to service_role;

create or replace function public.ai_org_month_usage(p_org_id uuid, p_since timestamptz default null)
returns table(model text, input_tokens bigint, output_tokens bigint, calls bigint)
language sql
stable
security definer
set search_path = public
as $function$
  select l.model,
         coalesce(sum(l.input_tokens), 0)::bigint,
         coalesce(sum(l.output_tokens), 0)::bigint,
         count(*)::bigint
  from public.ai_usage_log l
  where l.coach_id in (select om.profile_id from public.organization_memberships om where om.organization_id = p_org_id)
    and l.created_at >= coalesce(p_since, (date_trunc('month', now() at time zone 'utc')) at time zone 'utc')
    and l.status in ('ok', 'truncated')
  group by l.model;
$function$;
revoke all on function public.ai_org_month_usage(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.ai_org_month_usage(uuid, timestamptz) to service_role;

create table if not exists public.ai_budget_topups (
  id uuid primary key default uuid_generate_v4(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  month date not null,
  usd_added numeric not null check (usd_added > 0 and usd_added <= 1000),
  pack_cents integer not null check (pack_cents > 0),
  stripe_event_id text not null unique,
  created_at timestamptz not null default now()
);
create index if not exists ai_budget_topups_org_month_idx on public.ai_budget_topups (organization_id, month);
alter table public.ai_budget_topups enable row level security;
-- No policy at all: only the server (service role, from the payment webhook) writes or reads it.
revoke all on public.ai_budget_topups from anon, authenticated;

create table if not exists public.ai_budget_notices (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  month date not null,
  level text not null check (level in ('low', 'balance', 'out')),
  created_at timestamptz not null default now(),
  primary key (organization_id, month, level)
);
alter table public.ai_budget_notices enable row level security;
revoke all on public.ai_budget_notices from anon, authenticated;
