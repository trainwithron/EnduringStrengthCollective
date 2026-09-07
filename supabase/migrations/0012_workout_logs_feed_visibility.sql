-- ============================================================================
-- BUG FIX: workout_logs SELECT was restricted to the owning athlete or a
-- coach — but the team feed embeds workout_logs into every workout_summary
-- post for the WHOLE group to see (that's the feature). Any other athlete
-- viewing a teammate's PR post hit RLS on the nested join and got a blank
-- card, since PostgREST returns null for an embedded relation the current
-- role can't read rather than erroring.
--
-- Fix: SELECT opens to any group member, matching how `posts` itself is
-- already readable (`posts_select_members`). Write policies are unaffected
-- — only the athlete or a coach can still insert/update/delete.
-- ============================================================================
drop policy if exists "workout_logs_select_own_or_coach" on public.workout_logs;
create policy "workout_logs_select_members"
  on public.workout_logs for select
  to authenticated
  using (public.is_group_member(group_id));
