-- RELEASE CF (A CLIENT'S HEALTH SCREENING LINE ON OVERVIEW STAYS GONE ONCE ACKNOWLEDGED, UNTIL A NEW FLAGGED ANSWER; RUN BEFORE THE CODE THAT GOES WITH IT IS LIVE): ONE paste. Steps 126 in order, all or nothing.
--
-- Paste this whole file into the Supabase SQL editor and run it once. It replaces the separate precheck and apply files for these steps (they stay as the fallback).
-- Every check from each step's precheck is built in as a guard in front of that step. If any check is false, the run stops with a message that names the step and the
-- failed check, and NOTHING is kept, so a second run after a refusal is safe.
-- WHAT YOU SHOULD SEE: first "Success" for the transaction, then a result table with one row per step and in_place = true on every row.
-- ON ERROR: run   rollback;   once, copy the red text, send it to Spot. Do not run it again.
-- AFTER STEP 126: Nothing changes on screen until the code that goes with it is live. Then a flagged health screening shows once on the client's Overview as Health screening: N flagged with an Acknowledge button; after that it stays gone until the client has more flagged answers. The answers stay under Billing & settings.
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

-- ===== Release CF (a client's health screening line on Overview stays gone once acknowledged, until a new flagged answer; run BEFORE the code that goes with it is live), step 126: 0376 The health screening line on a client's Overview stays gone once acknowledged, until a new flagged answer
do $g126$
declare
  failed text;
begin
  select string_agg(check_name, '; ') into failed from (
    values
      ('0376 is not already applied (no count column yet)', not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'athlete_injury_flag_acknowledgements' and column_name = 'flagged_count')),
      ('the acknowledgements table exists', to_regclass('public.athlete_injury_flag_acknowledgements') is not null)
  ) as checks(check_name, ok) where not ok;
  if failed is not null then
    raise exception 'Release CF (a client''s health screening line on Overview stays gone once acknowledged, until a new flagged answer; run BEFORE the code that goes with it is live), step 126 (0376) cannot run: this step looks already applied, or the database is not in the state it expects. Failed checks: %. NOTHING was changed (the whole bundle is all or nothing). If an earlier step was applied by hand, use the single-step files for the rest, and send Spot this message.', failed;
  end if;
end
$g126$;

-- ====================================================================================================
-- migration 0376_parq_acknowledged_count.sql
-- ====================================================================================================

-- Release CF: the health screening line on a client's Overview. A coach acknowledges "Health screening: 2 flagged" once; it stays gone until a NEW flagged answer makes the count higher.
-- This reuses the row that already says "this coach has seen this client's flagged screening" (athlete_injury_flag_acknowledgements: one row per coach and client, private to that coach by row
-- security) and adds the one number it needs: how many flagged answers the coach had seen. Existing rows keep it empty, which counts as zero, so the line shows once more for them.
-- Re-runnable.
alter table public.athlete_injury_flag_acknowledgements add column if not exists flagged_count integer;

commit;

-- Read-only result (after the commit): every row must say in_place = true.
select step, what, in_place from (
  select 'step 126 (0376)' as step, '0376 The health screening line on a client''s Overview stays gone once acknowledged' as what, not ((not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'athlete_injury_flag_acknowledgements' and column_name = 'flagged_count'))) as in_place
) as result order by step;
