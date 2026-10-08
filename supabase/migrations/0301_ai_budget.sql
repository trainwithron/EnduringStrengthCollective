-- AI budget (nutrition tracking, phase 1). One monthly AI budget per coach, measured in real cost: every AI call is already logged with its model and token counts
-- (ai_usage_log, 0226); the app prices those tokens and compares the month's total with the coach's budget. This migration adds the two small pieces the database has to hold.
--
--  * ai_month_usage(coach, since): this month's AI use for one coach, summed by model (input tokens, output tokens, calls), counting only calls that finished (ok or cut off after
--    producing output); a failed call is never counted. Server-only: it reads a table nobody can read from the app. Priced in the app (lib/ai-budget.ts), so a price change
--    never needs a database change.
--  * ai_budget_notices: one row per coach, month and level ('low' = about 80 percent, 'out' = used up) so the coach is told ONCE, not on every request.
-- Nothing here changes who can read or write anything else. Re-runnable.

create or replace function public.ai_month_usage(p_coach_id uuid, p_since timestamptz default null)
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
  where l.coach_id = p_coach_id
    and l.created_at >= coalesce(p_since, (date_trunc('month', now() at time zone 'utc')) at time zone 'utc')
    and l.status in ('ok', 'truncated')
  group by l.model;
$function$;

revoke all on function public.ai_month_usage(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.ai_month_usage(uuid, timestamptz) to service_role;

create table if not exists public.ai_budget_notices (
  coach_id uuid not null references public.profiles(id) on delete cascade,
  month date not null,
  level text not null check (level in ('low', 'out')),
  created_at timestamptz not null default now(),
  primary key (coach_id, month, level)
);
alter table public.ai_budget_notices enable row level security;
-- No policy at all: only the server (service role) reads or writes it.
revoke all on public.ai_budget_notices from anon, authenticated;
