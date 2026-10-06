-- STEP 01 (PRECHECK, run first, changes nothing): 0249 coach completion message, 0250 AI allowance scaling, 0254 client tag write rules, 0240 guide dismissal, 0241 program label and order
--
-- Paste into the Supabase SQL editor and run. Every row must say ok = true.
-- If any row says false: do NOT run the apply file. Copy the result table and send it back.
select check_name, ok
from (
  values
    ('coach_profiles table exists (0249)',
      to_regclass('public.coach_profiles') is not null),
    ('0245 is applied: ai_charges, ai_usage_log and coach_credits exist (0250 builds on them)',
      to_regclass('public.ai_charges') is not null and to_regclass('public.ai_usage_log') is not null and to_regclass('public.coach_credits') is not null),
    ('organization_billing and organization_memberships exist (0250, 0254)',
      to_regclass('public.organization_billing') is not null and to_regclass('public.organization_memberships') is not null),
    ('spend_ai_action and reserve_ai_call exist (0250 replaces them)',
      exists (select 1 from pg_proc where proname = 'spend_ai_action' and pronamespace = 'public'::regnamespace) and exists (select 1 from pg_proc where proname = 'reserve_ai_call' and pronamespace = 'public'::regnamespace) and exists (select 1 from pg_proc where proname = 'coach_client_steps' and pronamespace = 'public'::regnamespace)),
    ('client_tags and client_tag_assignments exist (0254)',
      to_regclass('public.client_tags') is not null and to_regclass('public.client_tag_assignments') is not null and exists (select 1 from pg_proc where proname = 'is_org_member' and pronamespace = 'public'::regnamespace)),
    ('0254 is not already applied',
      not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'client_tags' and policyname = 'client_tags_insert_owner_admin')),
    ('programs and profiles tables exist (0240, 0241)',
      to_regclass('public.programs') is not null and to_regclass('public.profiles') is not null)
) as checks(check_name, ok);
