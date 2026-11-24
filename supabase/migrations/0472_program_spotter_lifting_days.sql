-- Step 228 (Ron, Nov 24: the program Spotter checks the days a week the client said they can train). The new check, lifting_days, flags a program of one client whose week has
-- more main lifting days (a Push, Pull, Legs or Full Body exercise) than their goal sheet's days_per_week; optional Core, Cardio and Mobility days never count. Its "not right"
-- and "stop suggesting" answers are remembered in programming_spotter_dismissals like every other check, so its check_kind is allowed there. Only that list changes (the same
-- pattern as 0193). Re-running is safe.
alter table public.programming_spotter_dismissals
  drop constraint if exists programming_spotter_dismissals_check_kind_check;

alter table public.programming_spotter_dismissals
  add constraint programming_spotter_dismissals_check_kind_check
  check (check_kind in ('volume_concentration', 'redundancy', 'flat_repeat', 'missing_pattern', 'biomech_redundancy', 'lifting_days'));
