-- RELEASE BU (PATTERN AND CLASS TEMPLATES: A ONE-SIDED MARK ON LADDER EXERCISES, PLUS EMPTY COLUMNS FOR SLOTS AND A CLIENT'S LEVEL; RUN BEFORE THE CODE THAT GOES WITH IT IS LIVE): ONE paste. Steps 115 in order, all or nothing.
--
-- Paste this whole file into the Supabase SQL editor and run it once. It replaces the separate precheck and apply files for these steps (they stay as the fallback).
-- Every check from each step's precheck is built in as a guard in front of that step. If any check is false, the run stops with a message that names the step and the
-- failed check, and NOTHING is kept, so a second run after a refusal is safe.
-- WHAT YOU SHOULD SEE: first "Success" for the transaction, then a result table with one row per step and in_place = true on every row.
-- ON ERROR: run   rollback;   once, copy the red text, send it to Spot. Do not run it again.
-- AFTER STEP 115: Nothing changes on screen until the code that goes with it is live. Then the Exercise Library can be sorted by pattern, side and class, and Add the starter ladders appears on the Movement Patterns tab. Run it BEFORE the code that goes with it is live.
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

-- ===== Release BU (pattern and class templates: a one-sided mark on ladder exercises, plus empty columns for slots and a client's level; run BEFORE the code that goes with it is live), step 115: 0365 Pattern and class templates: a ladder exercise can be marked one-sided (unilateral); the slot columns on a workout exercise and a client's training level are added (all empty, nothing reads them yet)
do $g115$
declare
  failed text;
begin
  select string_agg(check_name, '; ') into failed from (
    values
      ('0365 is not already applied (the ladder table has no unilateral column yet)', not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'movement_pattern_exercises' and column_name = 'is_unilateral')),
      ('the ladder, workout exercise and membership tables exist', to_regclass('public.movement_pattern_exercises') is not null and to_regclass('public.group_workout_exercises') is not null and to_regclass('public.group_memberships') is not null)
  ) as checks(check_name, ok) where not ok;
  if failed is not null then
    raise exception 'Release BU (pattern and class templates: a one-sided mark on ladder exercises, plus empty columns for slots and a client''s level; run BEFORE the code that goes with it is live), step 115 (0365) cannot run: this step looks already applied, or the database is not in the state it expects. Failed checks: %. NOTHING was changed (the whole bundle is all or nothing). If an earlier step was applied by hand, use the single-step files for the rest, and send Spot this message.', failed;
  end if;
end
$g115$;

-- ====================================================================================================
-- migration 0365_pattern_class_templates.sql
-- ====================================================================================================

-- Pattern + class templates. A movement pattern ladder rung can be marked one-sided (unilateral), so the library can be sorted by pattern, side and class
-- (a lunge is a unilateral squat; a single-arm press is a unilateral press) and a template slot can ask for "unilateral hinge, class A".
-- The slot columns on a workout exercise and a client's training level are added now (all nullable, nothing reads them yet) so the later releases need no second column change.
alter table public.movement_pattern_exercises
  add column if not exists is_unilateral boolean not null default false;

alter table public.group_workout_exercises
  add column if not exists is_slot boolean not null default false,
  add column if not exists slot_side text check (slot_side in ('bilateral', 'unilateral')),
  add column if not exists slot_tier text check (slot_tier in ('A', 'B', 'C'));

alter table public.group_memberships
  add column if not exists training_level text check (training_level in ('beginner', 'intermediate', 'advanced'));

commit;

-- Read-only result (after the commit): every row must say in_place = true.
select step, what, in_place from (
  select 'step 115 (0365)' as step, '0365 Pattern and class templates: a ladder exercise can be marked one-sided' as what, not ((not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'movement_pattern_exercises' and column_name = 'is_unilateral'))) as in_place
) as result order by step;
