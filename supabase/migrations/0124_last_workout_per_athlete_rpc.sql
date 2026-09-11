-- The Clients roster page ("Needs attention" sort) needs each athlete's
-- MOST RECENT workout_logs.created_at to sort by, but at real scale
-- (confirmed by a stress-test pass: 500 athletes -> 18.5s page load,
-- 1.1MB payload) fetching every raw workout_logs row for the group just
-- to reduce it to one MAX per athlete in JS is the wrong shape entirely
-- — it transfers O(total logged workouts ever) instead of O(roster size).
--
-- This aggregates in Postgres instead: at most one row per athlete who
-- has ever logged a workout in the group, regardless of how many logs
-- exist. Plain (not security definer) — RLS on workout_logs already
-- lets any group member (which a coach browsing their own roster is)
-- read every row in the group, so this function is exactly as
-- permissive as the query it replaces, no broader.
create or replace function public.get_last_workout_per_athlete(p_group_id uuid)
returns table (athlete_id uuid, last_logged_at timestamptz)
language sql
stable
security invoker
set search_path = public
as $$
  select workout_logs.athlete_id, max(workout_logs.created_at) as last_logged_at
  from public.workout_logs
  where workout_logs.group_id = p_group_id
  group by workout_logs.athlete_id;
$$;
