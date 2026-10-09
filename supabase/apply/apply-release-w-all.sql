-- RELEASE W (FUNCTION SEARCH PATHS AND THE ROW-SECURITY HELPER): ONE paste. Steps 65 in order, all or nothing.
--
-- Paste this whole file into the Supabase SQL editor and run it once. It replaces the separate precheck and apply files for these steps (they stay as the fallback).
-- Every check from each step's precheck is built in as a guard in front of that step. If any check is false, the run stops with a message that names the step and the
-- failed check, and NOTHING is kept, so a second run after a refusal is safe.
-- WHAT YOU SHOULD SEE: first "Success" for the transaction, then a result table with one row per step and in_place = true on every row.
-- ON ERROR: run   rollback;   once, copy the red text, send it to Spot. Do not run it again.
-- AFTER STEP 65: Nothing visible changes. The database advisor stops warning about the two audit functions' search path, and rls_auto_enable can no longer be run through the public API (it still turns row security on for a new table, as before).
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

-- ===== Release W (function search paths and the row-security helper), step 65: 0319 Three database functions are hardened: the two audit helpers get a fixed search path, and the database's own row-security helper (rls_auto_enable) is closed to signed-out visitors and signed-in users
do $g65$
declare
  failed text;
begin
  select string_agg(check_name, '; ') into failed from (
    values
      ('the audit functions exist (the audit trail is installed)', to_regprocedure('public.audit_log_refuse_changes()') is not null and to_regprocedure('public.audit_diff(jsonb, jsonb, text[])') is not null),
      ('0319 is not already applied (audit_diff has no fixed search path yet)', exists (select 1 from pg_proc where oid = 'public.audit_diff(jsonb, jsonb, text[])'::regprocedure and proconfig is null))
  ) as checks(check_name, ok) where not ok;
  if failed is not null then
    raise exception 'Release W (function search paths and the row-security helper), step 65 (0319) cannot run: this step looks already applied, or the database is not in the state it expects. Failed checks: %. NOTHING was changed (the whole bundle is all or nothing). If an earlier step was applied by hand, use the single-step files for the rest, and send Spot this message.', failed;
  end if;
end
$g65$;

-- ====================================================================================================
-- migration 0319_function_search_paths.sql
-- ====================================================================================================

-- Release W (audit): three small hardening changes on database functions, nothing a user can see.
--   * audit_log_refuse_changes() and audit_diff(jsonb, jsonb, text[]) had no fixed search_path (the database advisor flags that: a function should not look names up through
--     whatever search path the caller has). Both only use built-in operators and functions, so they are pinned to pg_catalog. Who can run them is not touched.
--   * rls_auto_enable() is the database's own "turn row security on for a new table" event helper. It runs as an event trigger (rights to run it are checked when the trigger is
--     created, not when it fires, and the trigger belongs to postgres), and nothing calls it as a normal function, but the public, signed-out visitors and signed-in users could
--     all run it through the API. It is closed to them; the server (service role) and the owner keep it.
-- Re-runnable. A function that does not exist in this database is skipped. Changes no data.

do $w$
begin
  if to_regprocedure('public.audit_log_refuse_changes()') is not null then
    execute 'alter function public.audit_log_refuse_changes() set search_path = pg_catalog';
  end if;
  if to_regprocedure('public.audit_diff(jsonb, jsonb, text[])') is not null then
    execute 'alter function public.audit_diff(jsonb, jsonb, text[]) set search_path = pg_catalog';
  end if;
  if to_regprocedure('public.rls_auto_enable()') is not null then
    execute 'revoke execute on function public.rls_auto_enable() from public, anon, authenticated';
  end if;
end
$w$;

commit;

-- Read-only result (after the commit): every row must say in_place = true.
select step, what, in_place from (
  select 'step 65 (0319)' as step, '0319 Three database functions are hardened: the two audit helpers get a fixed search path' as what, not ((exists (select 1 from pg_proc where oid = 'public.audit_diff(jsonb, jsonb, text[])'::regprocedure and proconfig is null))) as in_place
) as result order by step;
