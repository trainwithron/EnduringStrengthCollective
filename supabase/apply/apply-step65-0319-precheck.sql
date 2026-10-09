-- STEP 65 (PRECHECK, run first, changes nothing): 0319 Three database functions are hardened: the two audit helpers get a fixed search path, and the database's own row-security helper (rls_auto_enable) is closed to signed-out visitors and signed-in users
--
-- Paste into the Supabase SQL editor and run. Every row must say ok = true.
-- If any row says false: do NOT run the apply file. Copy the result table and send it back.
select check_name, ok
from (
  values
    ('the audit functions exist (the audit trail is installed)',
      to_regprocedure('public.audit_log_refuse_changes()') is not null and to_regprocedure('public.audit_diff(jsonb, jsonb, text[])') is not null),
    ('0319 is not already applied (audit_diff has no fixed search path yet)',
      exists (select 1 from pg_proc where oid = 'public.audit_diff(jsonb, jsonb, text[])'::regprocedure and proconfig is null))
) as checks(check_name, ok);
