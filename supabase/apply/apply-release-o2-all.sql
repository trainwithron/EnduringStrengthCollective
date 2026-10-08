-- RELEASE O FIX (CLOSE THE NOTICE FUNCTION; RUN ANY TIME AFTER RELEASE O): ONE paste. Steps 52 in order, all or nothing.
--
-- Paste this whole file into the Supabase SQL editor and run it once. It replaces the separate precheck and apply files for these steps (they stay as the fallback).
-- Every check from each step's precheck is built in as a guard in front of that step. If any check is false, the run stops with a message that names the step and the
-- failed check, and NOTHING is kept, so a second run after a refusal is safe.
-- WHAT YOU SHOULD SEE: first "Success" for the transaction, then a result table with one row per step and in_place = true on every row.
-- ON ERROR: run   rollback;   once, copy the red text, send it to Spot. Do not run it again.
-- AFTER STEP 52: Nothing visible changes: the notice still goes out when a coach applies a new target (the right to run a trigger function is checked when the trigger is made, not when it fires). Then run check-function-acl.sql: every row must say ok = true.
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

-- ===== Release O fix (close the notice function; run any time after Release O), step 52: 0307 Release O fix: the target-change notice function is closed to the public and signed-in users like the other internal functions (it was left open by default; it is a trigger function so nobody could call it, but internal functions are server-only on purpose)
do $g52$
declare
  failed text;
begin
  select string_agg(check_name, '; ') into failed from (
    values
      ('step 51 is applied (the notice function exists)', exists (select 1 from pg_proc where proname = 'notify_on_target_change' and pronamespace = 'public'::regnamespace)),
      ('0307 is not already applied (signed-in users can still run the notice function)', coalesce((select has_function_privilege('authenticated', p.oid, 'execute') from pg_proc p where p.proname = 'notify_on_target_change' and p.pronamespace = 'public'::regnamespace), false))
  ) as checks(check_name, ok) where not ok;
  if failed is not null then
    raise exception 'Release O fix (close the notice function; run any time after Release O), step 52 (0307) cannot run: this step looks already applied, or the database is not in the state it expects. Failed checks: %. NOTHING was changed (the whole bundle is all or nothing). If an earlier step was applied by hand, use the single-step files for the rest, and send Spot this message.', failed;
  end if;
end
$g52$;

-- ====================================================================================================
-- migration 0307_close_target_change_notice_function.sql
-- ====================================================================================================

-- Release O fix: notify_on_target_change() (0306, already applied on the live database before its revoke was added) is closed to the public and signed-in users like the other
-- internal functions. It is a trigger function, so it could never be called as a function by anyone, but internal functions are server-only on purpose. The trigger keeps firing
-- (the right to run a trigger function is checked when the trigger is created, not when it fires). Re-runnable; changes no data.
revoke all on function public.notify_on_target_change() from public, anon, authenticated;

commit;

-- Read-only result (after the commit): every row must say in_place = true.
select step, what, in_place from (
  select 'step 52 (0307)' as step, '0307 Release O fix: the target-change notice function is closed to the public and signed-in users like the other internal functions' as what, not ((coalesce((select has_function_privilege('authenticated', p.oid, 'execute') from pg_proc p where p.proname = 'notify_on_target_change' and p.pronamespace = 'public'::regnamespace), false))) as in_place
) as result order by step;
