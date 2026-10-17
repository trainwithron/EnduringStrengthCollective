-- STEP 140: 0388 Switch on the guard: a signed-in person's browser can no longer finish its own health form or waiver (the server does)
--
-- !! Run this only AFTER the Release D code is live (the new health form calls the server). With the old form still showing it would refuse to save.
--
-- Run apply-precheck first (every row ok = true). Then paste THIS file and run it once.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."
-- AFTERWARDS: From now on the health form and waiver are finished only by the app's server: a signed-in person's browser can no longer mark its own form complete or write the answers and signed name (it can still change its date of birth).
-- ON ERROR: it is all or nothing, so nothing was applied. Run   rollback;   once, copy the red error text, and send it back. Do not run the file again.
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

do $guard$
begin
  if not ((not exists (select 1 from pg_trigger where tgname = 'client_intake_guard_completion' and tgrelid = 'public.client_intake'::regclass))) then
    raise exception 'Step 140 (0388) looks already applied, or the database is not in the state it expects. Nothing was changed. Run the precheck file and send Spot the result.';
  end if;
end
$guard$;

-- ====================================================================================================
-- migration 0388_intake_guard_trigger.sql
-- ====================================================================================================

-- Release CP: switch on the guard made by 0386. From now on a signed-in person's browser cannot change the completion columns of client_intake (answers, signed name, accepted, completed time), on insert
-- or update; the server (service role) and the database owner still can. RUN THIS AFTER the Release D code is live: the old health form wrote those columns from the browser and would be refused.

drop trigger if exists client_intake_guard_completion on public.client_intake;
create trigger client_intake_guard_completion
  before insert or update on public.client_intake
  for each row execute function public.client_intake_guard_completion();

commit;
