-- STEP 139: 0387 Nothing about a person is public unless they chose it: a coach appears in Find a coach only after turning it on for themselves; a coach can add only their own clients to a challenge
--
-- Run apply-precheck first (every row ok = true). Then paste THIS file and run it once.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."
-- AFTERWARDS: No coach appears in Find a coach until each one turns on 'Show me in Find a coach' in Branding (every coach starts off, including coaches whose organization is already listed). A coach can no longer add a person who is not their client to a challenge.
-- ON ERROR: it is all or nothing, so nothing was applied. Run   rollback;   once, copy the red error text, and send it back. Do not run the file again.
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

do $guard$
begin
  if not ((not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'marketplace_listed'))) then
    raise exception 'Step 139 (0387) looks already applied, or the database is not in the state it expects. Nothing was changed. Run the precheck file and send Spot the result.';
  end if;
end
$guard$;

-- ====================================================================================================
-- migration 0387_minors_off_public_surfaces.sql
-- ====================================================================================================

-- Release CO: nothing about a person is public unless they chose it.
--   * profiles.marketplace_listed (off for everyone) and profiles.marketplace_display_name: a coach appears in the public "Find a coach" list only when their organization is listed AND they have turned
--     this on for themselves, under the name they typed (or first name and last initial).
--   * challenge_participants: a coach can add only a person who is a client in one of the coach's own groups (the rule let the coach insert ANY profile as a participant, which also made that person's
--     name visible to the other participants). A client joining on their own is unchanged.

alter table public.profiles add column if not exists marketplace_listed boolean not null default false;
alter table public.profiles add column if not exists marketplace_display_name text;
alter table public.profiles drop constraint if exists profiles_marketplace_display_name_length;
alter table public.profiles add constraint profiles_marketplace_display_name_length
  check (marketplace_display_name is null or char_length(marketplace_display_name) <= 60) not valid;

drop policy if exists "challenge_participants_insert_self_or_coach" on public.challenge_participants;
create policy "challenge_participants_insert_self_or_coach" on public.challenge_participants for insert
  to authenticated with check (
    ((profile_id = (select auth.uid())) and exists (select 1 from public.challenges c where c.id = challenge_participants.challenge_id and c.status = 'active' and public.is_client_of_coach(c.coach_id)))
    or (
      exists (select 1 from public.challenges c where c.id = challenge_participants.challenge_id and c.coach_id = (select auth.uid()))
      and exists (
        select 1
        from public.group_memberships a
        join public.group_memberships co on co.group_id = a.group_id and co.role = 'coach' and co.profile_id = (select auth.uid())
        where a.profile_id = challenge_participants.profile_id and a.role = 'athlete'
      )
    )
  );

commit;
