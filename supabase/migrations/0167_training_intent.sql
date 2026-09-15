-- Intuitive exercise finder + intent-aware programming
-- (intuitive_exercise_finder_and_intent_aware_programming.md) — a
-- nullable, coach-editable field naming a program's real training
-- intent (Powerlifting/Strength, Hypertrophy, Power/Explosive,
-- Conditioning/Endurance, General Fitness, Sport-specific, Youth,
-- Mobility/Flow). Smart-defaulted from the program name at creation
-- time (deterministic keyword match, same pattern the Programming
-- Spotter already uses — never a silent invisible guess), but always
-- visible/editable regardless of how it got set. Drives rest/tempo
-- tap-to-fill suggestions client-side — this column only stores the
-- coach's own explicit choice, nothing derived is persisted here.
alter table public.programs
  add column if not exists training_intent text;

comment on column public.programs.training_intent is
  'Coach-visible training intent (e.g. "Powerlifting/Strength", "Hypertrophy") — smart-defaulted from the program name, always directly editable. Drives rest/tempo tap-to-fill suggestions in the builder; not itself a computed/derived value.';
