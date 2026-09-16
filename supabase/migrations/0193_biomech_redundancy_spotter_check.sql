-- biomechanical_redundancy_consolidation_spotter_idea.md — the
-- Programming Spotter's tag-level extension of its own existing
-- redundancy check. One new check_kind value, reusing
-- programming_spotter_dismissals as-is (0154_programming_spotter_
-- dismissals.sql) — no new table needed.
alter table public.programming_spotter_dismissals
  drop constraint programming_spotter_dismissals_check_kind_check;

alter table public.programming_spotter_dismissals
  add constraint programming_spotter_dismissals_check_kind_check
  check (check_kind in ('volume_concentration', 'redundancy', 'flat_repeat', 'missing_pattern', 'biomech_redundancy'));
