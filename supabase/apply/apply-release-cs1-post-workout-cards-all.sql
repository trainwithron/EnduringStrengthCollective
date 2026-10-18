-- RELEASE CS1 (A GROUP SETTING FOR POST-WORKOUT CARDS AND PR NOTICES; ADDS ONE NULLABLE COLUMN, SAFE BEFORE THE CODE): ONE paste. Steps 166 in order, all or nothing.
--
-- Paste this whole file into the Supabase SQL editor and run it once. It replaces the separate precheck and apply files for these steps (they stay as the fallback).
-- Every check from each step's precheck is built in as a guard in front of that step. If any check is false, the run stops with a message that names the step and the
-- failed check, and NOTHING is kept, so a second run after a refusal is safe.
-- WHAT YOU SHOULD SEE: first "Success" for the transaction, then a result table with one row per step and in_place = true on every row.
-- ON ERROR: run   rollback;   once, copy the red text, send it to Spot. Do not run it again.
-- AFTER STEP 166: Nothing changes on screen until the Release CS1 code is live, and no group behaves differently by this alone: an empty setting means the default (off for a team-sport group, on otherwise). Adds one nullable column to groups. Safe to run before the code.
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

-- ===== Release CS1 (a group setting for post-workout cards and PR notices; adds one nullable column, safe before the code), step 166: 0414 Release CS1: a group setting for post-workout cards and PR notices (one nullable column)
do $g166$
declare
  failed text;
begin
  select string_agg(check_name, '; ') into failed from (
    values
      ('0414 is not already applied (the setting column is not there yet)', not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'groups' and column_name = 'post_workout_cards')),
      ('the table it builds on exists', to_regclass('public.groups') is not null)
  ) as checks(check_name, ok) where not ok;
  if failed is not null then
    raise exception 'Release CS1 (a group setting for post-workout cards and PR notices; adds one nullable column, safe before the code), step 166 (0414) cannot run: this step looks already applied, or the database is not in the state it expects. Failed checks: %. NOTHING was changed (the whole bundle is all or nothing). If an earlier step was applied by hand, use the single-step files for the rest, and send Spot this message.', failed;
  end if;
end
$g166$;

-- ====================================================================================================
-- migration 0414_group_post_workout_cards.sql
-- ====================================================================================================

-- Release CS1: a group setting, "Post-workout cards and PR notices".
-- null (the default for every group) means: OFF for a team-sport group (team_mode), ON for every other group; a coach's choice is stored as true or false. Adds one nullable column and nothing else; no group
-- changes behaviour by this file alone, and the app tolerates the column being missing. Re-runnable.
alter table public.groups add column if not exists post_workout_cards boolean;
comment on column public.groups.post_workout_cards is 'Null = default (off for a team-sport group, on otherwise). Controls the feed card, the share card and record notices after a workout, and the weekly milestone notices to athletes.';

commit;

-- Read-only result (after the commit): every row must say in_place = true.
select step, what, in_place from (
  select 'step 166 (0414)' as step, '0414 Release CS1: a group setting for post-workout cards and PR notices' as what, not ((not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'groups' and column_name = 'post_workout_cards'))) as in_place
) as result order by step;
