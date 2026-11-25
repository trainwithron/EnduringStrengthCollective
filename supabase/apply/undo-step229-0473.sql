-- UNDO: step 229. Only if it must be taken back: drafts are no longer tied to the client they were started for (Build program makes a new one every tap again).
-- Last result: one row, all true.

begin;

drop index if exists public.programs_for_client_draft_idx;
alter table public.programs drop column if exists for_client_id;

commit;

-- Check: one row, all true.
select
  not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'programs' and column_name = 'for_client_id') as column_gone,
  not exists (select 1 from pg_indexes where schemaname = 'public' and tablename = 'programs' and indexname = 'programs_for_client_draft_idx') as index_gone;
