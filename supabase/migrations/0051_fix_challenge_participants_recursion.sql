-- The original challenge_participants_select policy referenced
-- challenge_participants from within its own USING clause (checking
-- "is the viewer a participant of this same challenge"), which caused
-- Postgres to recurse infinitely re-evaluating the same policy. Fixed
-- the same way is_group_member/is_client_of_coach already solve this
-- elsewhere in this app: a security definer helper function, which
-- bypasses RLS internally instead of re-triggering it.
drop policy "challenge_participants_select" on public.challenge_participants;

create or replace function public.is_challenge_participant(target_challenge_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from public.challenge_participants
    where challenge_id = target_challenge_id and profile_id = auth.uid()
  );
$$;

create policy "challenge_participants_select" on public.challenge_participants for select
  to authenticated
  using (
    profile_id = auth.uid()
    or exists (select 1 from public.challenges c where c.id = challenge_id and c.coach_id = auth.uid())
    or public.is_challenge_participant(challenge_id)
  );
