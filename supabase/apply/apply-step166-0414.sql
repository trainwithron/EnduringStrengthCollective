-- STEP 166: 0414 Release CS1: a group setting for post-workout cards and PR notices (one nullable column)
--
-- Run apply-precheck first (every row ok = true). Then paste THIS file and run it once.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."
-- AFTERWARDS: Nothing changes on screen until the Release CS1 code is live, and no group behaves differently by this alone: an empty setting means the default (off for a team-sport group, on otherwise). Adds one nullable column to groups. Safe to run before the code.
-- ON ERROR: it is all or nothing, so nothing was applied. Run   rollback;   once, copy the red error text, and send it back. Do not run the file again.
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

do $guard$
begin
  if not ((not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'groups' and column_name = 'post_workout_cards'))) then
    raise exception 'Step 166 (0414) looks already applied, or the database is not in the state it expects. Nothing was changed. Run the precheck file and send Spot the result.';
  end if;
end
$guard$;

-- ====================================================================================================
-- migration 0414_group_post_workout_cards.sql
-- ====================================================================================================

-- Release CS1: a group setting, "Post-workout cards and PR notices".
-- null (the default for every group) means: OFF for a team-sport group (team_mode), ON for every other group; a coach's choice is stored as true or false. Adds one nullable column and nothing else; no group
-- changes behaviour by this file alone, and the app tolerates the column being missing. Re-runnable.
alter table public.groups add column if not exists post_workout_cards boolean;
comment on column public.groups.post_workout_cards is 'Null = default (off for a team-sport group, on otherwise). Controls the feed card, the share card and record notices after a workout, and the weekly milestone notices to athletes.';

commit;
