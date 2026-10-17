-- RELEASE CP (SWITCH ON THE GUARD: THE SERVER FINISHES THE HEALTH FORM AND WAIVER; RUN AFTER THE RELEASE D CODE IS LIVE): ONE paste. Steps 140 in order, all or nothing.
--
-- Paste this whole file into the Supabase SQL editor and run it once. It replaces the separate precheck and apply files for these steps (they stay as the fallback).
-- Every check from each step's precheck is built in as a guard in front of that step. If any check is false, the run stops with a message that names the step and the
-- failed check, and NOTHING is kept, so a second run after a refusal is safe.
-- WHAT YOU SHOULD SEE: first "Success" for the transaction, then a result table with one row per step and in_place = true on every row.
-- ON ERROR: run   rollback;   once, copy the red text, send it to Spot. Do not run it again.
-- AFTER STEP 140: From now on the health form and waiver are finished only by the app's server: a signed-in person's browser can no longer mark its own form complete or write the answers and signed name (it can still change its date of birth).
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

-- ===== Release CP (switch on the guard: the server finishes the health form and waiver; run AFTER the Release D code is live), step 140: 0388 Switch on the guard: a signed-in person's browser can no longer finish its own health form or waiver (the server does)
do $g140$
declare
  failed text;
begin
  select string_agg(check_name, '; ') into failed from (
    values
      ('step 140 is not already applied (the guard trigger is not there yet)', not exists (select 1 from pg_trigger where tgname = 'client_intake_guard_completion' and tgrelid = 'public.client_intake'::regclass)),
      ('step 137 is applied (the guard function exists)', to_regprocedure('public.client_intake_guard_completion()') is not null)
  ) as checks(check_name, ok) where not ok;
  if failed is not null then
    raise exception 'Release CP (switch on the guard: the server finishes the health form and waiver; run AFTER the Release D code is live), step 140 (0388) cannot run: this step looks already applied, or the database is not in the state it expects. Failed checks: %. NOTHING was changed (the whole bundle is all or nothing). If an earlier step was applied by hand, use the single-step files for the rest, and send Spot this message.', failed;
  end if;
end
$g140$;

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

-- Read-only result (after the commit): every row must say in_place = true.
select step, what, in_place from (
  select 'step 140 (0388)' as step, '0388 Switch on the guard: a signed-in person''s browser can no longer finish its own health form or waiver' as what, not ((not exists (select 1 from pg_trigger where tgname = 'client_intake_guard_completion' and tgrelid = 'public.client_intake'::regclass))) as in_place
) as result order by step;
