-- Athlete-facing swipe-direction preference for the exercise logging
-- carousel (swipe_card_logging_and_spotter_nudge_idea.md, resolved
-- 2026-09-14) — null means "not yet chosen," which is what gates the
-- first-run discovery prompt in the logger. The athlete can change it
-- later from Settings; a coach can also set it on a client's behalf
-- from the client's profile page.
alter table public.profiles
  add column exercise_swipe_direction text
  check (exercise_swipe_direction in ('vertical', 'horizontal'));
