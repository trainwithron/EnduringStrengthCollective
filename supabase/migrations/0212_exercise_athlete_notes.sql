-- Exercise athlete notes (coach_dashboard_redesign_scoping.md's injury-
-- keyword flag prerequisite) — a plain, low-friction free-text field an
-- athlete can leave on any exercise during normal logging, separate
-- from and much simpler than session_exercise_videos/
-- exercise_video_comments (which require an uploaded video). No coach
-- reply thread — this is a note, not a conversation; a coach who wants
-- to respond already has the nudge-message and profile-note surfaces.
-- Existing RLS on session_exercises (session_exercises_update_own_or_coach,
-- 0110) already covers both the athlete and a coach logging in-person,
-- so no new policy is needed for this column.
alter table public.session_exercises
  add column athlete_note text;
