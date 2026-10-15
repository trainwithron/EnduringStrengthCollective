-- STEP 126: 0376 The health screening line on a client's Overview stays gone once acknowledged, until a new flagged answer
--
-- Run apply-precheck first (every row ok = true). Then paste THIS file and run it once.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."
-- AFTERWARDS: Nothing changes on screen until the code that goes with it is live. Then a flagged health screening shows once on the client's Overview as Health screening: N flagged with an Acknowledge button; after that it stays gone until the client has more flagged answers. The answers stay under Billing & settings.
-- ON ERROR: it is all or nothing, so nothing was applied. Run   rollback;   once, copy the red error text, and send it back. Do not run the file again.
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

do $guard$
begin
  if not ((not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'athlete_injury_flag_acknowledgements' and column_name = 'flagged_count'))) then
    raise exception 'Step 126 (0376) looks already applied, or the database is not in the state it expects. Nothing was changed. Run the precheck file and send Spot the result.';
  end if;
end
$guard$;

-- ====================================================================================================
-- migration 0376_parq_acknowledged_count.sql
-- ====================================================================================================

-- Release CF: the health screening line on a client's Overview. A coach acknowledges "Health screening: 2 flagged" once; it stays gone until a NEW flagged answer makes the count higher.
-- This reuses the row that already says "this coach has seen this client's flagged screening" (athlete_injury_flag_acknowledgements: one row per coach and client, private to that coach by row
-- security) and adds the one number it needs: how many flagged answers the coach had seen. Existing rows keep it empty, which counts as zero, so the line shows once more for them.
-- Re-runnable.
alter table public.athlete_injury_flag_acknowledgements add column if not exists flagged_count integer;

commit;
