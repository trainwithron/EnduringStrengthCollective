-- PASTE: step 228 (the program Spotter can be told "not right" about its new check: more lifting days than the client can train). Paste all of it into the Supabase SQL editor
-- and run. Last result: one row, all true.

begin;

-- Step 228 (Ron, Nov 24: the program Spotter checks the days a week the client said they can train). The new check, lifting_days, flags a program of one client whose week has
-- more main lifting days (a Push, Pull, Legs or Full Body exercise) than their goal sheet's days_per_week; optional Core, Cardio and Mobility days never count. Its "not right"
-- and "stop suggesting" answers are remembered in programming_spotter_dismissals like every other check, so its check_kind is allowed there. Only that list changes (the same
-- pattern as 0193). Re-running is safe.
alter table public.programming_spotter_dismissals
  drop constraint if exists programming_spotter_dismissals_check_kind_check;

alter table public.programming_spotter_dismissals
  add constraint programming_spotter_dismissals_check_kind_check
  check (check_kind in ('volume_concentration', 'redundancy', 'flat_repeat', 'missing_pattern', 'biomech_redundancy', 'lifting_days'));

commit;

-- Check: one row, all true.
select
  position('lifting_days' in (select pg_get_constraintdef(oid) from pg_constraint where conname = 'programming_spotter_dismissals_check_kind_check' and conrelid = 'public.programming_spotter_dismissals'::regclass)) > 0 as lifting_days_allowed,
  (select count(*) from pg_constraint where conname = 'programming_spotter_dismissals_check_kind_check' and conrelid = 'public.programming_spotter_dismissals'::regclass) = 1 as one_check,
  (select count(*) from unnest(array['volume_concentration', 'redundancy', 'flat_repeat', 'missing_pattern', 'biomech_redundancy']) k
     where position(k in (select pg_get_constraintdef(oid) from pg_constraint where conname = 'programming_spotter_dismissals_check_kind_check' and conrelid = 'public.programming_spotter_dismissals'::regclass)) > 0) = 5 as the_five_before_still_allowed;
