-- dup_gzclp_build_spec_sept15.md §1.2 — GZCLP's T1 (main lift) tier is
-- the one piece of the methodology that genuinely can't be expressed
-- through the three existing progression_model values: it needs 3-way
-- branching on stage (5x3+ -> 6x2+ -> 10x1+) replayed across full
-- occurrence history, not the two-outcome, two-point logic
-- double_progression already has. T2/T3 needed no schema change at all
-- (config-only against double_progression, see lib/progressions.test.ts).
alter type progression_model add value 'gzclp_t1';

-- Pure display metadata, doesn't touch the progression math — lets the
-- UI badge a lift "T1"/"T2"/"T3" for the coach even though T2 and T3
-- are both plain double_progression rows underneath, distinguishable
-- only by their config numbers otherwise.
alter table public.exercise_progressions
  add column tier_label text;
