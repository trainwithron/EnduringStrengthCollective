-- Swipe-card logging redesign (mobile_home_workout_tab_merge_idea.md /
-- swipe_card_logging_and_spotter_nudge_idea.md) — the expanded card's
-- "coach note first" space needs a genuinely athlete-visible note, which
-- session_exercise_coach_notes (0126) deliberately does not provide (its
-- own comment: "never athlete-visible... a real, independently-testable
-- RLS policy"). Rather than loosen that blanket boundary, this adds an
-- explicit per-note opt-in flag a coach must set themselves — false by
-- default, so every existing note stays exactly as private as it always
-- was until a coach deliberately shares one.
alter table public.session_exercise_coach_notes
  add column visible_to_athlete boolean not null default false;

create policy "session_exercise_coach_notes_select_visible_athlete"
  on public.session_exercise_coach_notes for select
  to authenticated
  using (
    visible_to_athlete
    and exists (
      select 1
      from public.session_exercises se
      join public.athlete_sessions asess on asess.id = se.session_id
      where se.id = session_exercise_coach_notes.session_exercise_id
        and asess.athlete_id = (select auth.uid())
    )
  );
