-- STEP 02 (PRECHECK, run first, changes nothing): 0244 macro target history and row security, 0255 legal acceptances and locked waiver, 0256 marketplace listing opt-in, 0257 feedback reports, 0258 help-search log
--
-- Paste into the Supabase SQL editor and run. Every row must say ok = true.
-- If any row says false: do NOT run the apply file. Copy the result table and send it back.
select check_name, ok
from (
  values
    ('client_macro_targets exists (0239 is applied)',
      to_regclass('public.client_macro_targets') is not null),
    ('0244 is not already applied',
      to_regclass('public.client_macro_target_history') is null),
    ('client_intake exists and is_group_coach exists (0255)',
      to_regclass('public.client_intake') is not null and exists (select 1 from pg_proc where proname = 'is_group_coach' and pronamespace = 'public'::regnamespace)),
    ('0255 is not already applied',
      to_regclass('public.legal_acceptances') is null),
    ('organizations exists (0256)',
      to_regclass('public.organizations') is not null),
    ('is_platform_admin() exists (0257, 0258)',
      to_regprocedure('public.is_platform_admin()') is not null),
    ('0257 and 0258 are not already applied',
      to_regclass('public.feedback_reports') is null and to_regclass('public.nav_query_log') is null)
) as checks(check_name, ok);
