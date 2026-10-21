-- A coach's own passages for Read during rest (Ron, Oct 21: "If I [feel] ones on my heart, I can put it in there", and then: type your own verse so it joins the rotation). A coach
-- adds a reference and its text (King James first, his words); they join the passage cycle of each of his clients (lib/read-content: the bundled list plus his own, each client in their
-- own shuffled order, no repeats until all are seen). He reads, adds, changes and removes only his own; a person in a group he coaches can read them (to be shown during rest). New table
-- only. Re-runnable.

create table if not exists public.coach_read_passages (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid not null references public.profiles(id) on delete cascade,
  reference text not null,
  text text not null,
  created_at timestamptz not null default now(),
  constraint coach_read_passages_reference_ok check (char_length(btrim(reference)) between 1 and 60),
  constraint coach_read_passages_text_ok check (char_length(btrim(text)) between 1 and 600)
);
create index if not exists coach_read_passages_coach_idx on public.coach_read_passages (coach_id, created_at);

alter table public.coach_read_passages enable row level security;

drop policy if exists "coach_read_passages_select" on public.coach_read_passages;
create policy "coach_read_passages_select" on public.coach_read_passages for select to authenticated
  using (
    coach_id = (select auth.uid())
    or exists (
      select 1
      from public.group_memberships me
      join public.group_memberships c on c.group_id = me.group_id and c.role = 'coach' and c.profile_id = coach_read_passages.coach_id
      where me.profile_id = (select auth.uid())
    )
  );
drop policy if exists "coach_read_passages_insert_own" on public.coach_read_passages;
-- Only a coach adds one (for himself).
create policy "coach_read_passages_insert_own" on public.coach_read_passages for insert to authenticated
  with check (coach_id = (select auth.uid()) and exists (select 1 from public.group_memberships gm where gm.profile_id = (select auth.uid()) and gm.role = 'coach'));
drop policy if exists "coach_read_passages_update_own" on public.coach_read_passages;
create policy "coach_read_passages_update_own" on public.coach_read_passages for update to authenticated
  using (coach_id = (select auth.uid())) with check (coach_id = (select auth.uid()));
drop policy if exists "coach_read_passages_delete_own" on public.coach_read_passages;
create policy "coach_read_passages_delete_own" on public.coach_read_passages for delete to authenticated using (coach_id = (select auth.uid()));

revoke all on public.coach_read_passages from anon;
-- Row policies do not govern TRUNCATE, REFERENCES or TRIGGER; no app path needs them.
revoke truncate, references, trigger on public.coach_read_passages from authenticated;
