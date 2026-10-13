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
