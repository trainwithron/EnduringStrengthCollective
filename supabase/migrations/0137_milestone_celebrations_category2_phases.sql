-- Milestone Celebrations, Category 2 — widen nutrition_phases beyond
-- just reverse_diet. Cut and bulk both get the same trend-
-- classification treatment (lib/nutrition-trend-classifier.ts).
alter table public.nutrition_phases drop constraint nutrition_phases_phase_check;
alter table public.nutrition_phases add constraint nutrition_phases_phase_check
  check (phase in ('reverse_diet', 'cut', 'bulk'));

-- New celebratory type: the tagged phase's trend actually matches what
-- was intended (e.g. a real cut showing calories+weight both down).
-- Distinct from 'reverse_diet', which keeps its own already-shipped,
-- more tightly calibrated success check untouched.
alter table public.milestone_events drop constraint milestone_events_milestone_type_check;
alter table public.milestone_events add constraint milestone_events_milestone_type_check
  check (milestone_type in ('reverse_diet', 'recovery_volume', 'phase_alignment'));
