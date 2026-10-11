-- RELEASE AL (A CLIENT CAN SWITCH THEIR FIRST NAME OFF SHARED WORKOUT PICTURES; RUN ANY TIME): ONE paste. Steps 80 in order, all or nothing.
--
-- Paste this whole file into the Supabase SQL editor and run it once. It replaces the separate precheck and apply files for these steps (they stay as the fallback).
-- Every check from each step's precheck is built in as a guard in front of that step. If any check is false, the run stops with a message that names the step and the
-- failed check, and NOTHING is kept, so a second run after a refusal is safe.
-- WHAT YOU SHOULD SEE: first "Success" for the transaction, then a result table with one row per step and in_place = true on every row.
-- ON ERROR: run   rollback;   once, copy the red text, send it to Spot. Do not run it again.
-- AFTER STEP 80: Nothing changes for anyone until a client switches it off in their own Settings. Everyone's first name keeps showing on their shared workout pictures, as it does now.
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

-- ===== Release AL (a client can switch their first name off shared workout pictures; run any time), step 80: 0334 A client can choose whether their first name is shown on their shared workout pictures (on for everyone until they switch it off)
do $g80$
declare
  failed text;
begin
  select string_agg(check_name, '; ') into failed from (
    values
      ('0334 is not already applied (profiles has no show_name_on_share yet)', not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'show_name_on_share')),
      ('profiles has the earlier share-picture column (0197)', exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'preferred_share_background'))
  ) as checks(check_name, ok) where not ok;
  if failed is not null then
    raise exception 'Release AL (a client can switch their first name off shared workout pictures; run any time), step 80 (0334) cannot run: this step looks already applied, or the database is not in the state it expects. Failed checks: %. NOTHING was changed (the whole bundle is all or nothing). If an earlier step was applied by hand, use the single-step files for the rest, and send Spot this message.', failed;
  end if;
end
$g80$;

-- ====================================================================================================
-- migration 0334_share_name_setting.sql
-- ====================================================================================================

-- Release AL: a client chooses whether their FIRST NAME is shown on their shared workout pictures (the post-workout card and the picture they post). One small column on profiles,
-- next to preferred_share_background (0197). The public share page reads it on the server (with the service role, like the rest of the card), so no new read rule is needed.
-- The column starts EMPTY (null = "has not chosen"): the app then shows the name for an adult and leaves it off for a client under 18, from the date of birth on their intake form;
-- a client who switches it on or off in Settings (true or false) always decides for themselves. Nothing needs filling in for anyone already in the app.
-- New column only, nothing else touched.
alter table public.profiles add column if not exists show_name_on_share boolean;

commit;

-- Read-only result (after the commit): every row must say in_place = true.
select step, what, in_place from (
  select 'step 80 (0334)' as step, '0334 A client can choose whether their first name is shown on their shared workout pictures' as what, not ((not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'show_name_on_share'))) as in_place
) as result order by step;
