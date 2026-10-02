-- Strength Meet Week Taper (goal_date_aware_nutrition_and_programming_
-- idea.md) — client_goals has no link to a movement pattern at all
-- today (event_type is free text a client types, never matched against
-- movement_patterns). This adds the real structured link needed to
-- resolve "the main lift" for a powerlifting/strength-meet goal: which
-- movement pattern's tier-A exercise the taper's heavy-single guidance
-- should be computed from. Nullable and coach-set (a client never picks
-- their own coach's movement-pattern taxonomy) — same additive shape as
-- the existing weight_class_flag column (0156).
alter table public.client_goals
  add column main_lift_movement_pattern_id uuid references public.movement_patterns(id) on delete set null;
