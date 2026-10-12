-- RELEASE AQ (A TRANSFORMATION CARD CAN ONLY USE THE ATHLETE'S OWN PHOTOS AND MILESTONE, NEVER FOR A CLIENT UNDER 18; RUN ANY TIME): ONE paste. Steps 85 in order, all or nothing.
--
-- Paste this whole file into the Supabase SQL editor and run it once. It replaces the separate precheck and apply files for these steps (they stay as the fallback).
-- Every check from each step's precheck is built in as a guard in front of that step. If any check is false, the run stops with a message that names the step and the
-- failed check, and NOTHING is kept, so a second run after a refusal is safe.
-- WHAT YOU SHOULD SEE: first "Success" for the transaction, then a result table with one row per step and in_place = true on every row.
-- ON ERROR: run   rollback;   once, copy the red text, send it to Spot. Do not run it again.
-- AFTER STEP 85: Nothing changes for normal use. Cards that already exist are untouched. A card can no longer be saved with someone else's photo or a group the person is not a client of, and cannot be made for a client under 18.
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

-- ===== Release AQ (a transformation card can only use the athlete's own photos and milestone, never for a client under 18; run any time), step 85: 0339 A transformation card can only use the athlete's own photos and milestone, in a group they are a client of, and is never made for a client under 18
do $g85$
declare
  failed text;
begin
  select string_agg(check_name, '; ') into failed from (
    values
      ('0339 is not already applied (the new insert rule is absent)', not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'transformation_cards' and policyname = 'transformation_cards_insert_own')),
      ('the earlier card write rule is in place', exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'transformation_cards' and policyname = 'transformation_cards_write_own')),
      ('the tables the new rule checks exist', to_regclass('public.progress_photos') is not null and to_regclass('public.transformation_milestones') is not null and to_regclass('public.client_intake') is not null)
  ) as checks(check_name, ok) where not ok;
  if failed is not null then
    raise exception 'Release AQ (a transformation card can only use the athlete''s own photos and milestone, never for a client under 18; run any time), step 85 (0339) cannot run: this step looks already applied, or the database is not in the state it expects. Failed checks: %. NOTHING was changed (the whole bundle is all or nothing). If an earlier step was applied by hand, use the single-step files for the rest, and send Spot this message.', failed;
  end if;
end
$g85$;

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

-- Read-only result (after the commit): every row must say in_place = true.
select step, what, in_place from (
  select 'step 85 (0339)' as step, '0339 A transformation card can only use the athlete''s own photos and milestone' as what, not ((not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'transformation_cards' and policyname = 'transformation_cards_insert_own'))) as in_place
) as result order by step;
