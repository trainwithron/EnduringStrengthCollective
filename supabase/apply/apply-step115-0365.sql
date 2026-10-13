-- STEP 115: 0365 Pattern and class templates: a ladder exercise can be marked one-sided (unilateral); the slot columns on a workout exercise and a client's training level are added (all empty, nothing reads them yet)
--
-- Run apply-precheck first (every row ok = true). Then paste THIS file and run it once.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."
-- AFTERWARDS: Nothing changes on screen until the code that goes with it is live. Then the Exercise Library can be sorted by pattern, side and class, and Add the starter ladders appears on the Movement Patterns tab. Run it BEFORE the code that goes with it is live.
-- ON ERROR: it is all or nothing, so nothing was applied. Run   rollback;   once, copy the red error text, and send it back. Do not run the file again.
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

do $guard$
begin
  if not ((not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'movement_pattern_exercises' and column_name = 'is_unilateral'))) then
    raise exception 'Step 115 (0365) looks already applied, or the database is not in the state it expects. Nothing was changed. Run the precheck file and send Spot the result.';
  end if;
end
$guard$;

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
