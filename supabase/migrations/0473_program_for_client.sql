-- Step 229 (Ron, Nov 24: four "Robyn's program" drafts, one for every tap of Build program). A program started from a client's page has no client on it until "Assign to
-- [First]" gives the client their own copy, so nothing tied the draft to the client and every tap made a new one. for_client_id says which client a coach's draft was started
-- for; Build program reads it to open that client's newest draft that is not assigned, hidden or followed (and offers "Start a new one instead"). Nothing else reads it.
-- Old drafts have none and are simply not reopened (no backfill). The same table athlete_id points at; a client removed leaves the draft with the coach. Re-running is safe.
alter table public.programs
  add column if not exists for_client_id uuid references public.profiles(id) on delete set null;

create index if not exists programs_for_client_draft_idx
  on public.programs (created_by, for_client_id)
  where for_client_id is not null and archived_at is null;
