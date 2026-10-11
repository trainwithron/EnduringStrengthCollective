-- STEP 82: 0336 The 'What do you call your people?' card is asked once, for good (remembered on the coach's profile; every coach already here counts as answered)
--
-- Run apply-precheck first (every row ok = true). Then paste THIS file and run it once.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."
-- AFTERWARDS: Every coach who is already in the app is marked as having answered, so none of them see the card again, and it no longer comes back on a new browser or device. A coach who joins later is asked once.
-- ON ERROR: it is all or nothing, so nothing was applied. Run   rollback;   once, copy the red error text, and send it back. Do not run the file again.
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

do $guard$
begin
  if not ((not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'terminology_asked_at'))) then
    raise exception 'Step 82 (0336) looks already applied, or the database is not in the state it expects. Nothing was changed. Run the precheck file and send Spot the result.';
  end if;
end
$guard$;

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
