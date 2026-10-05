-- STEP 1 of 2 for migration 0267 (audit trail). Paste into the Supabase SQL editor and run on its own. It changes nothing.
-- Every row must say ok = true. If any row says false, do NOT run step 2 (apply-0267.sql); send the result back.
select check_name, ok
from (
  values
    ('0266 is applied (the profile column guard exists)',
      to_regprocedure('public.guard_profile_sensitive_columns()') is not null),
    ('0085 guard exists (prevent_platform_admin_self_escalation)',
      to_regprocedure('public.prevent_platform_admin_self_escalation()') is not null),
    ('is_platform_admin() exists',
      to_regprocedure('public.is_platform_admin()') is not null),
    ('session_credits, bookings and organization_billing tables exist',
      to_regclass('public.session_credits') is not null and to_regclass('public.bookings') is not null and to_regclass('public.organization_billing') is not null),
    ('athlete_sessions, workout_logs, posts, direct_messages and training_partner_requests tables exist',
      to_regclass('public.athlete_sessions') is not null and to_regclass('public.workout_logs') is not null and to_regclass('public.posts') is not null
      and to_regclass('public.direct_messages') is not null and to_regclass('public.training_partner_requests') is not null)
) as checks(check_name, ok);
