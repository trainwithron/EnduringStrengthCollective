-- UNDO: step 228. Only if it must be taken back: the program Spotter's remembered answers about the lifting-days check are removed (they mean nothing without it), and the
-- list of checks is back to the five of step 0193. Last result: one row, all true.

begin;

delete from public.programming_spotter_dismissals where check_kind = 'lifting_days';

alter table public.programming_spotter_dismissals
  drop constraint if exists programming_spotter_dismissals_check_kind_check;

alter table public.programming_spotter_dismissals
  add constraint programming_spotter_dismissals_check_kind_check
  check (check_kind in ('volume_concentration', 'redundancy', 'flat_repeat', 'missing_pattern', 'biomech_redundancy'));

commit;

-- Check: one row, all true.
select
  position('lifting_days' in (select pg_get_constraintdef(oid) from pg_constraint where conname = 'programming_spotter_dismissals_check_kind_check' and conrelid = 'public.programming_spotter_dismissals'::regclass)) = 0 as back_to_the_five,
  not exists (select 1 from public.programming_spotter_dismissals where check_kind = 'lifting_days') as no_lifting_days_answers;
