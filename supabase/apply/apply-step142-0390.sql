-- STEP 142: 0390 Release H: undo a whole history import (every workout an import creates carries one batch id)
--
-- Run apply-precheck first (every row ok = true). Then paste THIS file and run it once.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."
-- AFTERWARDS: Nothing changes on screen. Imports made after the Release H code is live can be undone as one batch from the History page; imports made before have no batch and are still deleted one workout at a time. Adds one empty column and an index. Safe to run before the code is live.
-- ON ERROR: it is all or nothing, so nothing was applied. Run   rollback;   once, copy the red error text, and send it back. Do not run the file again.
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

do $guard$
begin
  if not ((not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'athlete_sessions' and column_name = 'import_batch_id'))) then
    raise exception 'Step 142 (0390) looks already applied, or the database is not in the state it expects. Nothing was changed. Run the precheck file and send Spot the result.';
  end if;
end
$guard$;

-- ====================================================================================================
-- migration 0390_import_batch_undo.sql
-- ====================================================================================================

-- 0390: undo a whole history import. Every workout an import creates carries the same batch id, so "Undo this import" removes exactly that import's entries (and nothing the person logged live).
-- Adds one nullable column and one index. Safe to run before the code that uses it is live.
alter table public.athlete_sessions add column if not exists import_batch_id uuid;
create index if not exists athlete_sessions_import_batch_idx on public.athlete_sessions (import_batch_id) where import_batch_id is not null;

commit;
