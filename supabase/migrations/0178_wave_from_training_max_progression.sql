-- dup_gzclp_build_spec_sept15.md §2.3 Path B — DUP's dynamic variant.
-- Same wave math as the existing 'wave' model, just sourced from
-- athlete_training_maxes.estimated_max instead of the athlete's own
-- first logged occurrence inside the program, so every week's target
-- self-updates the moment a new PR lands rather than needing a full
-- program regenerate (Path A's real limitation).
alter type progression_model add value 'wave_from_training_max';
