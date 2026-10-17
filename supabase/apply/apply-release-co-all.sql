-- RELEASE CO (NOTHING ABOUT A PERSON IS PUBLIC UNLESS THEY CHOSE IT: PERSONAL FIND A COACH LISTING; A COACH ADDS ONLY THEIR OWN CLIENTS TO A CHALLENGE; RUN BEFORE THE CODE THAT GOES WITH IT IS LIVE): ONE paste. Steps 139 in order, all or nothing.
--
-- Paste this whole file into the Supabase SQL editor and run it once. It replaces the separate precheck and apply files for these steps (they stay as the fallback).
-- Every check from each step's precheck is built in as a guard in front of that step. If any check is false, the run stops with a message that names the step and the
-- failed check, and NOTHING is kept, so a second run after a refusal is safe.
-- WHAT YOU SHOULD SEE: first "Success" for the transaction, then a result table with one row per step and in_place = true on every row.
-- ON ERROR: run   rollback;   once, copy the red text, send it to Spot. Do not run it again.
-- AFTER STEP 139: No coach appears in Find a coach until each one turns on 'Show me in Find a coach' in Branding (every coach starts off, including coaches whose organization is already listed). A coach can no longer add a person who is not their client to a challenge.
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

-- ===== Release CO (nothing about a person is public unless they chose it: personal Find a coach listing; a coach adds only their own clients to a challenge; run BEFORE the code that goes with it is live), step 139: 0387 Nothing about a person is public unless they chose it: a coach appears in Find a coach only after turning it on for themselves; a coach can add only their own clients to a challenge
do $g139$
declare
  failed text;
begin
  select string_agg(check_name, '; ') into failed from (
    values
      ('0387 is not already applied (the personal listing column is not there yet)', not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'marketplace_listed')),
      ('the tables it builds on exist', to_regclass('public.challenge_participants') is not null and to_regclass('public.challenges') is not null)
  ) as checks(check_name, ok) where not ok;
  if failed is not null then
    raise exception 'Release CO (nothing about a person is public unless they chose it: personal Find a coach listing; a coach adds only their own clients to a challenge; run BEFORE the code that goes with it is live), step 139 (0387) cannot run: this step looks already applied, or the database is not in the state it expects. Failed checks: %. NOTHING was changed (the whole bundle is all or nothing). If an earlier step was applied by hand, use the single-step files for the rest, and send Spot this message.', failed;
  end if;
end
$g139$;

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

-- Read-only result (after the commit): every row must say in_place = true.
select step, what, in_place from (
  select 'step 139 (0387)' as step, '0387 Nothing about a person is public unless they chose it: a coach appears in Find a coach only after turning it on for themselves' as what, not ((not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'marketplace_listed'))) as in_place
) as result order by step;
