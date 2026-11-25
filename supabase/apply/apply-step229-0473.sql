-- PASTE: step 229 (Build program reopens the client's draft instead of making a new program every tap). Paste all of it into the Supabase SQL editor and run.
-- Last result: one row, all true. If the precheck stops it, nothing was changed: run "rollback;" and tell Spot.

begin;

-- Precheck: the two tables it joins are there, and the column is not already pointing somewhere else.
do $$
begin
  if to_regclass('public.programs') is null or to_regclass('public.profiles') is null then
    raise exception 'step 229 precheck: public.programs or public.profiles is missing';
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'programs' and column_name = 'for_client_id' and data_type <> 'uuid') then
    raise exception 'step 229 precheck: programs.for_client_id exists with another type';
  end if;
end $$;

-- Step 229 (Ron, Nov 24: four "Robyn's program" drafts, one for every tap of Build program). A program started from a client's page has no client on it until "Assign to
-- [First]" gives the client their own copy, so nothing tied the draft to the client and every tap made a new one. for_client_id says which client a coach's draft was started
-- for; Build program reads it to open that client's newest draft that is not assigned, hidden or followed (and offers "Start a new one instead"). Nothing else reads it.
-- Old drafts have none and are simply not reopened (no backfill). The same table athlete_id points at; a client removed leaves the draft with the coach. Re-running is safe.
alter table public.programs
  add column if not exists for_client_id uuid references public.profiles(id) on delete set null;

create index if not exists programs_for_client_draft_idx
  on public.programs (created_by, for_client_id)
  where for_client_id is not null and archived_at is null;

commit;

-- Check: one row, all true.
select
  exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'programs' and column_name = 'for_client_id' and data_type = 'uuid') as column_there,
  exists (select 1 from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
          where c.conrelid = 'public.programs'::regclass and c.contype = 'f' and a.attname = 'for_client_id' and c.confrelid = 'public.profiles'::regclass and c.confdeltype = 'n') as points_at_profiles_set_null,
  exists (select 1 from pg_indexes where schemaname = 'public' and tablename = 'programs' and indexname = 'programs_for_client_draft_idx') as index_there;
