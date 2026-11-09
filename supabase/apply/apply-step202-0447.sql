-- PASTE: step 202 (Clients can join their organization's shared group from their Home, sharing their workouts there or keeping them private). Paste all of this into the Supabase SQL editor and Run. The last result is 5 rows; every one should say true.

begin;

-- Clients joining their organization's shared group from their own Home (Ron, Nov 9: clients are PROMPTED to join and told what it includes, never added automatically).
-- 1. group_memberships.shares_workouts: on a client's social-only seat in a shared group, whether the workouts they finish in their own space are also posted to that group's feed
--    (and so count on its leaderboard). Off means the client is in the group, sees everything, and posts nothing from their workouts there. Default off.
-- 2. Only the server (the join route, which checks it is the client asking) or the SQL editor sets it: a coach cannot switch a client's sharing on or off for them.
-- 3. The members of that group can read the totals of a workout card the client shared there (the workout itself lives in the client's own one-on-one space, which only the
--    client and their coach can read). Only while that client is still in the group with sharing on, and only for a card the client is the author of.
-- Nothing existing is changed. Re-running is safe.

alter table public.group_memberships add column if not exists shares_workouts boolean not null default false;

create index if not exists group_memberships_sharing_idx on public.group_memberships (group_id, profile_id) where shares_workouts;

create or replace function public.guard_membership_shares_workouts()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- a signed-in person writing directly (not the server, not the SQL editor)
  if auth.uid() is not null and coalesce(auth.role(), '') <> 'service_role' then
    if tg_op = 'INSERT' and new.shares_workouts then
      raise exception 'Only the client can choose to share their workouts with a group.' using errcode = '42501';
    elsif tg_op = 'UPDATE' and new.shares_workouts is distinct from old.shares_workouts then
      raise exception 'Only the client can choose to share their workouts with a group.' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists group_memberships_guard_shares_workouts on public.group_memberships;
create trigger group_memberships_guard_shares_workouts
  before insert or update of shares_workouts on public.group_memberships
  for each row execute function public.guard_membership_shares_workouts();

-- The workout logs behind the shared cards in the groups the signed-in person belongs to.
create or replace function public.my_shared_card_workout_log_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select p.workout_log_id
  from public.group_memberships sm
  join public.posts p
    on p.group_id = sm.group_id
   and p.author_id = sm.profile_id
   and p.post_type = 'workout_summary'
   and p.workout_log_id is not null
  join public.workout_logs wl
    on wl.id = p.workout_log_id
   and wl.athlete_id = sm.profile_id
   and wl.group_id is distinct from sm.group_id
  where sm.shares_workouts
    and sm.role = 'athlete'
    and sm.membership_type = 'social_only'
    and sm.group_id in (select gm.group_id from public.group_memberships gm where gm.profile_id = auth.uid())
$$;

revoke all on function public.my_shared_card_workout_log_ids() from public, anon;
grant execute on function public.my_shared_card_workout_log_ids() to authenticated;

drop policy if exists "workout_logs_select_shared_card" on public.workout_logs;
create policy "workout_logs_select_shared_card" on public.workout_logs for select to authenticated
  using (id in (select public.my_shared_card_workout_log_ids()));

commit;

select 'group_memberships has shares_workouts, off by default' as check_name, exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'group_memberships' and column_name = 'shares_workouts' and column_default = 'false' and is_nullable = 'NO') as ok
union all select 'only the client (through the server) can switch sharing', exists (select 1 from pg_trigger where tgname = 'group_memberships_guard_shares_workouts' and tgrelid = 'public.group_memberships'::regclass and not tgisinternal)
union all select 'shared cards reader is there for signed-in people', to_regprocedure('public.my_shared_card_workout_log_ids()') is not null and has_function_privilege('authenticated', 'public.my_shared_card_workout_log_ids()', 'execute')
union all select 'visitors cannot use it', not has_function_privilege('anon', 'public.my_shared_card_workout_log_ids()', 'execute')
union all select 'group members can read the totals of a shared card', exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'workout_logs' and policyname = 'workout_logs_select_shared_card');
