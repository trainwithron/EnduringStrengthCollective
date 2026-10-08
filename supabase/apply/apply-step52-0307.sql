-- STEP 52: 0307 Release O fix: the target-change notice function is closed to the public and signed-in users like the other internal functions (it was left open by default; it is a trigger function so nobody could call it, but internal functions are server-only on purpose)
--
-- Run apply-precheck first (every row ok = true). Then paste THIS file and run it once.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."
-- AFTERWARDS: Nothing visible changes: the notice still goes out when a coach applies a new target (the right to run a trigger function is checked when the trigger is made, not when it fires). Then run check-function-acl.sql: every row must say ok = true.
-- ON ERROR: it is all or nothing, so nothing was applied. Run   rollback;   once, copy the red error text, and send it back. Do not run the file again.
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

do $guard$
begin
  if not ((coalesce((select has_function_privilege('authenticated', p.oid, 'execute') from pg_proc p where p.proname = 'notify_on_target_change' and p.pronamespace = 'public'::regnamespace), false))) then
    raise exception 'Step 52 (0307) looks already applied, or the database is not in the state it expects. Nothing was changed. Run the precheck file and send Spot the result.';
  end if;
end
$guard$;

-- ====================================================================================================
-- migration 0307_close_target_change_notice_function.sql
-- ====================================================================================================

-- Release O fix: notify_on_target_change() (0306, already applied on the live database before its revoke was added) is closed to the public and signed-in users like the other
-- internal functions. It is a trigger function, so it could never be called as a function by anyone, but internal functions are server-only on purpose. The trigger keeps firing
-- (the right to run a trigger function is checked when the trigger is created, not when it fires). Re-runnable; changes no data.
revoke all on function public.notify_on_target_change() from public, anon, authenticated;

commit;
