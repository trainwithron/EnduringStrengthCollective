-- RELEASE H (UNDO A WHOLE HISTORY IMPORT; ADDS ONLY, SAFE TO RUN BEFORE THE CODE THAT GOES WITH IT IS LIVE): ONE paste. Steps 142 in order, all or nothing.
--
-- Paste this whole file into the Supabase SQL editor and run it once. It replaces the separate precheck and apply files for these steps (they stay as the fallback).
-- Every check from each step's precheck is built in as a guard in front of that step. If any check is false, the run stops with a message that names the step and the
-- failed check, and NOTHING is kept, so a second run after a refusal is safe.
-- WHAT YOU SHOULD SEE: first "Success" for the transaction, then a result table with one row per step and in_place = true on every row.
-- ON ERROR: run   rollback;   once, copy the red text, send it to Spot. Do not run it again.
-- AFTER STEP 142: Nothing changes on screen. Imports made after the Release H code is live can be undone as one batch from the History page; imports made before have no batch and are still deleted one workout at a time. Adds one empty column and an index. Safe to run before the code is live.
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

-- ===== Release H (undo a whole history import; adds only, safe to run BEFORE the code that goes with it is live), step 142: 0390 Release H: undo a whole history import (every workout an import creates carries one batch id)
do $g142$
declare
  failed text;
begin
  select string_agg(check_name, '; ') into failed from (
    values
      ('0390 is not already applied (the batch column is not there yet)', not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'athlete_sessions' and column_name = 'import_batch_id')),
      ('the table it builds on exists', to_regclass('public.athlete_sessions') is not null)
  ) as checks(check_name, ok) where not ok;
  if failed is not null then
    raise exception 'Release H (undo a whole history import; adds only, safe to run BEFORE the code that goes with it is live), step 142 (0390) cannot run: this step looks already applied, or the database is not in the state it expects. Failed checks: %. NOTHING was changed (the whole bundle is all or nothing). If an earlier step was applied by hand, use the single-step files for the rest, and send Spot this message.', failed;
  end if;
end
$g142$;

-- ====================================================================================================
-- migration 0390_import_batch_undo.sql
-- ====================================================================================================

-- 0390: undo a whole history import. Every workout an import creates carries the same batch id, so "Undo this import" removes exactly that import's entries (and nothing the person logged live).
-- Adds one nullable column and one index. Safe to run before the code that uses it is live.
alter table public.athlete_sessions add column if not exists import_batch_id uuid;
create index if not exists athlete_sessions_import_batch_idx on public.athlete_sessions (import_batch_id) where import_batch_id is not null;

commit;

-- Read-only result (after the commit): every row must say in_place = true.
select step, what, in_place from (
  select 'step 142 (0390)' as step, '0390 Release H: undo a whole history import' as what, not ((not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'athlete_sessions' and column_name = 'import_batch_id'))) as in_place
) as result order by step;
