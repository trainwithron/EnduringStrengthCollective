-- STEP 85: 0339 A transformation card can only use the athlete's own photos and milestone, in a group they are a client of, and is never made for a client under 18
--
-- Run apply-precheck first (every row ok = true). Then paste THIS file and run it once.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."
-- AFTERWARDS: Nothing changes for normal use. Cards that already exist are untouched. A card can no longer be saved with someone else's photo or a group the person is not a client of, and cannot be made for a client under 18.
-- ON ERROR: it is all or nothing, so nothing was applied. Run   rollback;   once, copy the red error text, and send it back. Do not run the file again.
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

do $guard$
begin
  if not ((not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'transformation_cards' and policyname = 'transformation_cards_insert_own'))) then
    raise exception 'Step 85 (0339) looks already applied, or the database is not in the state it expects. Nothing was changed. Run the precheck file and send Spot the result.';
  end if;
end
$guard$;

-- ====================================================================================================
-- migration 0339_transformation_cards_ownership.sql
-- ====================================================================================================

-- Release AQ: a transformation card can only name the athlete's OWN progress photos and milestone, in a group they are a client of, and is never made for a client under 18.
-- Before, the one write policy only checked athlete_id = the signed-in user, so a card could carry anyone's progress-photo id (the public card page then signed that photo) and any group id.
-- Existing cards are untouched; the rules apply to cards written from now on. The public card page checks the same things when it reads (app code), so an old card with a foreign photo shows nothing.
drop policy if exists "transformation_cards_write_own" on public.transformation_cards;

create policy "transformation_cards_insert_own" on public.transformation_cards for insert
  to authenticated with check (
    athlete_id = (select auth.uid())
    and exists (select 1 from public.group_memberships gm where gm.group_id = transformation_cards.group_id and gm.profile_id = (select auth.uid()) and gm.role = 'athlete')
    and (before_photo_id is null or exists (select 1 from public.progress_photos p where p.id = transformation_cards.before_photo_id and p.athlete_id = (select auth.uid())))
    and (after_photo_id is null or exists (select 1 from public.progress_photos p where p.id = transformation_cards.after_photo_id and p.athlete_id = (select auth.uid())))
    and (milestone_id is null or exists (select 1 from public.transformation_milestones m where m.id = transformation_cards.milestone_id and m.athlete_id = (select auth.uid())))
    and not exists (select 1 from public.client_intake ci where ci.athlete_id = (select auth.uid()) and ci.date_of_birth > (current_date - interval '18 years')::date)
  );

create policy "transformation_cards_update_own" on public.transformation_cards for update
  to authenticated using (athlete_id = (select auth.uid()))
  with check (
    athlete_id = (select auth.uid())
    and exists (select 1 from public.group_memberships gm where gm.group_id = transformation_cards.group_id and gm.profile_id = (select auth.uid()) and gm.role = 'athlete')
    and (before_photo_id is null or exists (select 1 from public.progress_photos p where p.id = transformation_cards.before_photo_id and p.athlete_id = (select auth.uid())))
    and (after_photo_id is null or exists (select 1 from public.progress_photos p where p.id = transformation_cards.after_photo_id and p.athlete_id = (select auth.uid())))
    and (milestone_id is null or exists (select 1 from public.transformation_milestones m where m.id = transformation_cards.milestone_id and m.athlete_id = (select auth.uid())))
  );

create policy "transformation_cards_delete_own" on public.transformation_cards for delete
  to authenticated using (athlete_id = (select auth.uid()));

commit;
