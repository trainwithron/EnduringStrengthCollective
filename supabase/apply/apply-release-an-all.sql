-- RELEASE AN (THE 'WHAT DO YOU CALL YOUR PEOPLE' CARD IS ASKED ONCE, FOR GOOD; RUN ANY TIME): ONE paste. Steps 82 in order, all or nothing.
--
-- Paste this whole file into the Supabase SQL editor and run it once. It replaces the separate precheck and apply files for these steps (they stay as the fallback).
-- Every check from each step's precheck is built in as a guard in front of that step. If any check is false, the run stops with a message that names the step and the
-- failed check, and NOTHING is kept, so a second run after a refusal is safe.
-- WHAT YOU SHOULD SEE: first "Success" for the transaction, then a result table with one row per step and in_place = true on every row.
-- ON ERROR: run   rollback;   once, copy the red text, send it to Spot. Do not run it again.
-- AFTER STEP 82: Every coach who is already in the app is marked as having answered, so none of them see the card again, and it no longer comes back on a new browser or device. A coach who joins later is asked once.
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

-- ===== Release AN (the 'what do you call your people' card is asked once, for good; run any time), step 82: 0336 The 'What do you call your people?' card is asked once, for good (remembered on the coach's profile; every coach already here counts as answered)
do $g82$
declare
  failed text;
begin
  select string_agg(check_name, '; ') into failed from (
    values
      ('0336 is not already applied (profiles has no terminology_asked_at yet)', not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'terminology_asked_at')),
      ('coaches are recorded in group_memberships', exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'group_memberships' and column_name = 'role'))
  ) as checks(check_name, ok) where not ok;
  if failed is not null then
    raise exception 'Release AN (the ''what do you call your people'' card is asked once, for good; run any time), step 82 (0336) cannot run: this step looks already applied, or the database is not in the state it expects. Failed checks: %. NOTHING was changed (the whole bundle is all or nothing). If an earlier step was applied by hand, use the single-step files for the rest, and send Spot this message.', failed;
  end if;
end
$g82$;

-- ====================================================================================================
-- migration 0336_terminology_asked.sql
-- ====================================================================================================

-- Release AN: the "What do you call your people?" card on a coach's Home is asked ONCE, for good. Until now the "already answered" flag lived only in the browser (localStorage), so a new
-- browser, a cleared profile or a second device asked again, and choosing the default word never counted as an answer. Now it is a date on the coach's own profile: empty until they pick any
-- word (the default included) or close the card, and the card is shown only while it is empty.
-- Backfill: every coach who exists now counts as having answered, so nobody who is already using the app is asked again. A coach who joins after this is asked once.
alter table public.profiles add column if not exists terminology_asked_at timestamptz;
update public.profiles set terminology_asked_at = now()
 where terminology_asked_at is null
   and id in (select gm.profile_id from public.group_memberships gm where gm.role = 'coach');

commit;

-- Read-only result (after the commit): every row must say in_place = true.
select step, what, in_place from (
  select 'step 82 (0336)' as step, '0336 The ''What do you call your people?'' card is asked once' as what, not ((not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'terminology_asked_at'))) as in_place
) as result order by step;
