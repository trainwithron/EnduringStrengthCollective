-- ============================================================================
-- BUG FIX: athlete_sessions only ever got an INSERT policy for the athlete
-- themselves (sessions_insert_own, from 0001). The 0002 coach-oversight
-- patch widened UPDATE/DELETE to let a coach correct an existing session,
-- but never widened INSERT — so a coach starting a brand new session on a
-- client's behalf (in-person training) was rejected by RLS with a bare 403.
-- session_exercises/set_logs writes were already coach-inclusive from 0002
-- (they just check the parent session's athlete_id-or-coach), so this is
-- the only gap.
-- ============================================================================
drop policy if exists "sessions_insert_own" on public.athlete_sessions;
create policy "sessions_insert_own_or_coach"
  on public.athlete_sessions for insert
  to authenticated
  with check (
    (athlete_id = auth.uid() or public.is_group_coach(group_id))
    and public.is_group_member(group_id)
  );
