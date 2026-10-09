-- STEP 65: 0319 Three database functions are hardened: the two audit helpers get a fixed search path, and the database's own row-security helper (rls_auto_enable) is closed to signed-out visitors and signed-in users
--
-- Run apply-precheck first (every row ok = true). Then paste THIS file and run it once.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."
-- AFTERWARDS: Nothing visible changes. The database advisor stops warning about the two audit functions' search path, and rls_auto_enable can no longer be run through the public API (it still turns row security on for a new table, as before).
-- ON ERROR: it is all or nothing, so nothing was applied. Run   rollback;   once, copy the red error text, and send it back. Do not run the file again.
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

do $guard$
begin
  if not ((exists (select 1 from pg_proc where oid = 'public.audit_diff(jsonb, jsonb, text[])'::regprocedure and proconfig is null))) then
    raise exception 'Step 65 (0319) looks already applied, or the database is not in the state it expects. Nothing was changed. Run the precheck file and send Spot the result.';
  end if;
end
$guard$;

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
