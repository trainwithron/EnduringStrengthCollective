-- UNDO step 202 (joining the shared group). Group members stop seeing the totals on shared workout cards, and everyone's share-my-workouts choice is forgotten. Nobody is removed from any group, and no post is deleted.
drop policy if exists "workout_logs_select_shared_card" on public.workout_logs;
drop function if exists public.my_shared_card_workout_log_ids();
drop trigger if exists group_memberships_guard_shares_workouts on public.group_memberships;
drop function if exists public.guard_membership_shares_workouts();
drop index if exists public.group_memberships_sharing_idx;
alter table public.group_memberships drop column if exists shares_workouts;
