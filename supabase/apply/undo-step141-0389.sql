-- UNDO for step 141 (0389). Only if step 141 misbehaves. Run it only while the Release G code is not live (the Business page, Home and the nightly digest call the three count functions and would show a load error without them). Removes the functions, the indexes, the value rule on sets and the test mark. Sets that step 141 flagged unclear stay flagged (a coach can accept them in Unclear data points); workouts it paused stay paused.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."   Then tell Spot, and do not run the step again until Spot says why it failed.
begin;
drop function if exists public.close_stale_sessions(integer);
alter table public.organizations drop column if exists is_test;
alter table public.set_logs drop constraint if exists set_logs_values_in_range;
drop index if exists public.ai_usage_log_created_idx;
drop index if exists public.set_logs_completed_at_idx;
drop index if exists public.nutrition_checkins_group_created_idx;
drop index if exists public.bookings_group_start_idx;
drop index if exists public.credit_purchases_group_created_idx;
drop index if exists public.workout_logs_group_created_idx;
drop index if exists public.workout_logs_group_athlete_created_idx;
drop function if exists public.coach_digest_activity(uuid, uuid[]);
drop function if exists public.coach_unseen_groups(uuid[]);
drop function if exists public.business_last_active(uuid[]);
commit;
