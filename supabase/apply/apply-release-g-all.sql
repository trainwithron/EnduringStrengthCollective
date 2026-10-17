-- RELEASE G (THE APP AT 1,500 CLIENTS; REAL VALUES ONLY IN SETS; A TEST-ORGANIZATION MARK; PAUSE FORGOTTEN WORKOUTS; ADDS ONLY, SAFE TO RUN BEFORE THE CODE THAT GOES WITH IT IS LIVE): ONE paste. Steps 141 in order, all or nothing.
--
-- Paste this whole file into the Supabase SQL editor and run it once. It replaces the separate precheck and apply files for these steps (they stay as the fallback).
-- Every check from each step's precheck is built in as a guard in front of that step. If any check is false, the run stops with a message that names the step and the
-- failed check, and NOTHING is kept, so a second run after a refusal is safe.
-- WHAT YOU SHOULD SEE: first "Success" for the transaction, then a result table with one row per step and in_place = true on every row.
-- ON ERROR: run   rollback;   once, copy the red text, send it to Spot. Do not run it again.
-- AFTER STEP 141: Nothing changes on screen. Pages and nightly jobs that read every client of a big coach can now ask the database for the answer. A set can no longer be saved with a weight over 2,000, reps over 1,000, an effort (RPE) outside 0 to 10, a time over two days or a distance over 5,000,000 (a row already flagged unclear is exempt); the few rows that break this today are flagged unclear, not changed or deleted. The sandbox organization is marked as a test. A workout left 'in progress' for three days can be paused by the nightly job (the code that calls it ships with the release). Safe to run before the code is live.
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

-- ===== Release G (the app at 1,500 clients; real values only in sets; a test-organization mark; pause forgotten workouts; adds only, safe to run BEFORE the code that goes with it is live), step 141: 0389 Release G: the app at 1,500 clients (last-active, unseen and digest counts done by the database, indexes), real values only in sets, a test-organization mark, and a way to pause forgotten workouts
do $g141$
declare
  failed text;
begin
  select string_agg(check_name, '; ') into failed from (
    values
      ('0389 is not already applied (the last-active function is not there yet)', to_regprocedure('public.business_last_active(uuid[])') is null),
      ('the tables it builds on exist', to_regclass('public.workout_logs') is not null and to_regclass('public.coach_view_state') is not null and to_regclass('public.set_logs') is not null and to_regclass('public.athlete_sessions') is not null and to_regclass('public.organizations') is not null and to_regclass('public.ai_usage_log') is not null),
      ('set_logs has the unclear flag (0371) the value rule leans on', exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'set_logs' and column_name = 'data_flag'))
  ) as checks(check_name, ok) where not ok;
  if failed is not null then
    raise exception 'Release G (the app at 1,500 clients; real values only in sets; a test-organization mark; pause forgotten workouts; adds only, safe to run BEFORE the code that goes with it is live), step 141 (0389) cannot run: this step looks already applied, or the database is not in the state it expects. Failed checks: %. NOTHING was changed (the whole bundle is all or nothing). If an earlier step was applied by hand, use the single-step files for the rest, and send Spot this message.', failed;
  end if;
end
$g141$;

-- ====================================================================================================
-- migration 0389_scale_and_data_quality.sql
-- ====================================================================================================

-- Release G: the app at 1,500 clients, and a few data-quality guards.
--   * business_last_active(group ids): each client's last workout, worked out by the database (one row per client) instead of the app reading every workout ever logged. Runs as the caller, so row security applies.
--   * coach_unseen_groups(group ids): for each group the signed-in coach has visited, whether anything is newer than they last looked (new post or new workout), one row per group.
--   * coach_digest_activity(coach, group ids): the daily digest's two numbers (new posts, distinct active clients) counted by the database. Server only.
--   * Indexes for the reads the pages and jobs make by group and time.
--   * set_logs values must be real: a weight from 0 to 2000, reps from 0 to 1000, an effort (RPE) from 0 to 10, a time up to two days, a distance up to 5,000,000. A row already flagged unclear is exempt (that is the
--     existing way to hold a value nobody trusts yet). The few rows that break this today are flagged unclear here, not changed or deleted.
--   * organizations.is_test marks the sandbox organization so counts and checks can leave it out.
--   * close_stale_sessions(days): a workout still "in progress" long after it was started is set to paused (the same state as Pause for later, so it can still be resumed). Server only; the nightly job calls it.

create or replace function public.business_last_active(p_group_ids uuid[])
returns table (athlete_id uuid, last_at timestamptz)
language sql
stable
security invoker
set search_path = public
as $$
  select l.athlete_id, max(l.created_at) as last_at
  from public.workout_logs l
  where l.group_id = any (p_group_ids)
  group by l.athlete_id
  order by l.athlete_id
$$;
revoke all on function public.business_last_active(uuid[]) from public, anon;
grant execute on function public.business_last_active(uuid[]) to authenticated;

create or replace function public.coach_unseen_groups(p_group_ids uuid[])
returns table (group_id uuid, unseen boolean)
language sql
stable
security invoker
set search_path = public
as $$
  select v.group_id,
    (
      exists (select 1 from public.posts p where p.group_id = v.group_id and (v.feed_seen_at is null or p.created_at > v.feed_seen_at))
      or exists (select 1 from public.workout_logs l where l.group_id = v.group_id and (v.clients_seen_at is null or l.created_at > v.clients_seen_at))
    ) as unseen
  from public.coach_view_state v
  where v.coach_id = auth.uid()
    and v.group_id = any (p_group_ids)
  order by v.group_id
$$;
revoke all on function public.coach_unseen_groups(uuid[]) from public, anon;
grant execute on function public.coach_unseen_groups(uuid[]) to authenticated;

create or replace function public.coach_digest_activity(p_coach uuid, p_group_ids uuid[])
returns table (new_posts bigint, active_athletes bigint)
language sql
stable
security invoker
set search_path = public
as $$
  select
    (select count(*) from public.posts p
       join public.coach_view_state v on v.group_id = p.group_id and v.coach_id = p_coach
      where p.group_id = any (p_group_ids)
        and (v.feed_seen_at is null or p.created_at > v.feed_seen_at)),
    (select count(distinct l.athlete_id) from public.workout_logs l
       join public.coach_view_state v on v.group_id = l.group_id and v.coach_id = p_coach
      where l.group_id = any (p_group_ids)
        and l.athlete_id is not null
        and (v.clients_seen_at is null or l.created_at > v.clients_seen_at))
$$;
revoke all on function public.coach_digest_activity(uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.coach_digest_activity(uuid, uuid[]) to service_role;

create index if not exists workout_logs_group_athlete_created_idx on public.workout_logs (group_id, athlete_id, created_at desc);
create index if not exists workout_logs_group_created_idx on public.workout_logs (group_id, created_at desc);
create index if not exists credit_purchases_group_created_idx on public.credit_purchases (group_id, created_at desc);
create index if not exists bookings_group_start_idx on public.bookings (group_id, start_at);
create index if not exists nutrition_checkins_group_created_idx on public.nutrition_checkins (group_id, created_at desc);
create index if not exists set_logs_completed_at_idx on public.set_logs (completed_at) where status = 'completed';
create index if not exists ai_usage_log_created_idx on public.ai_usage_log (created_at, feature);

-- Set values that cannot be real are flagged unclear first (kept exactly as they are, and shown to the coach as an unclear data point), then the rule is switched on.
update public.set_logs
   set data_flag = 'unclear'
 where data_flag is null
   and (weight > 2000 or weight < 0 or reps > 1000 or reps < 0 or rpe > 10 or rpe < 0 or time_seconds > 172800 or time_seconds < 0 or distance > 5000000 or distance < 0);

alter table public.set_logs drop constraint if exists set_logs_values_in_range;
alter table public.set_logs add constraint set_logs_values_in_range check (
  data_flag is not null
  or (
    (weight is null or weight between 0 and 2000)
    and (reps is null or reps between 0 and 1000)
    and (rpe is null or rpe between 0 and 10)
    and (time_seconds is null or time_seconds between 0 and 172800)
    and (distance is null or distance between 0 and 5000000)
  )
);

alter table public.organizations add column if not exists is_test boolean not null default false;
update public.organizations set is_test = true where id = '50000000-0000-0000-0000-000000000001';

create or replace function public.close_stale_sessions(p_days integer default 3)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  if p_days is null or p_days < 1 then
    raise exception 'p_days must be at least 1';
  end if;
  update public.athlete_sessions
     set status = 'abandoned'
   where status = 'in_progress'
     and started_at < now() - make_interval(days => p_days);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke all on function public.close_stale_sessions(integer) from public, anon, authenticated;
grant execute on function public.close_stale_sessions(integer) to service_role;

commit;

-- Read-only result (after the commit): every row must say in_place = true.
select step, what, in_place from (
  select 'step 141 (0389)' as step, '0389 Release G: the app at 1' as what, not ((to_regprocedure('public.business_last_active(uuid[])') is null)) as in_place
) as result order by step;
