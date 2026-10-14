-- Release CA: unclear data points in imported history.
-- A set from a history import can be jumbled or impossible ("20, 20, 2" lb as three sets, a weight ten times the rest, reps over 100, a weight with no reps). It is KEPT, exactly as entered, but
-- marked unclear: data_flag = 'unclear' with a plain reason. The coach can count it (data_flag = 'accepted') or take it out of the numbers again, or fix it by hand and count it. Only the single set
-- is marked, never the whole exercise. Nothing is lost or changed: the set's weight and reps stay as imported. (A later release makes every total, graph, estimated max and PR count only sets that
-- are not unclear. This release changes no number anywhere.)
--
--   * set_logs.data_flag / data_flag_reason: null = nothing to question. Only a coach of the client's group can change them (a guard trigger), so a client cannot clear a mark on their own history.
--     (The check function below is the one other writer: it may be run by the client for their own history, because it only ever adds marks.)
--   * flag_unclear_sets(athlete, group): marks the suspicious imported sets of one client. One rule set, in one place, used by the backfill below and by the history importers after they write.
--     It never touches a set that is already marked or accepted, so running it again changes nothing the coach has decided.
--   * set_unclear_point_counted(set, counts): the coach's "Count it" / "Don't count it".
-- The backfill at the end marks the suspicious sets of every existing import once. Re-runnable.

alter table public.set_logs
  add column if not exists data_flag text,
  add column if not exists data_flag_reason text;

alter table public.set_logs drop constraint if exists set_logs_data_flag_check;
alter table public.set_logs add constraint set_logs_data_flag_check check (data_flag is null or data_flag in ('unclear', 'accepted'));

create index if not exists set_logs_unclear_idx on public.set_logs (session_exercise_id) where data_flag = 'unclear';

-- Only a coach of the group can set or change the mark.
create or replace function public.guard_set_log_flag_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group uuid;
begin
  if auth.uid() is null or auth.role() = 'service_role' or current_setting('app.flagging_unclear', true) = '1' then
    return new;
  end if;
  select s.group_id into v_group
  from public.session_exercises se
  join public.athlete_sessions s on s.id = se.session_id
  where se.id = new.session_exercise_id;
  if coalesce(public.is_group_coach(v_group), false) then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.data_flag := null;
    new.data_flag_reason := null;
  else
    new.data_flag := old.data_flag;
    new.data_flag_reason := old.data_flag_reason;
  end if;
  return new;
end;
$$;

revoke all on function public.guard_set_log_flag_columns() from public, anon, authenticated;

drop trigger if exists set_logs_guard_flag_insert on public.set_logs;
create trigger set_logs_guard_flag_insert
  before insert on public.set_logs
  for each row
  when (new.data_flag is not null or new.data_flag_reason is not null)
  execute function public.guard_set_log_flag_columns();

drop trigger if exists set_logs_guard_flag_update on public.set_logs;
create trigger set_logs_guard_flag_update
  before update on public.set_logs
  for each row
  when (new.data_flag is distinct from old.data_flag or new.data_flag_reason is distinct from old.data_flag_reason)
  execute function public.guard_set_log_flag_columns();

-- The rules, one place. Only imported (historical) sets are questioned, and only completed ones.
--   1. reps over 100
--   2. a weight with no reps (and no time, distance or height), for an exercise the client otherwise logs WITH reps: an exercise that is always weight-only (a carry) is fine
--   3. a weight eight times the usual for that exercise (the client's median weight; needs 5 weighted sets to judge)
--   4. the last set of an exercise far below the others (under a quarter of them, when the others agree with each other: 20, 20, 2)
-- A weight of 0 is never questioned (an unloaded bodyweight move).
create or replace function public.flag_unclear_sets(p_athlete uuid, p_group uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  -- The coach of the group, or the client for their own history (the check only marks, it never changes a number).
  if auth.uid() is not null and auth.role() <> 'service_role' then
    if not (
      (coalesce(public.is_group_coach(p_group), false) and coalesce(public.group_in_active_org(p_group), false))
      or (auth.uid() = p_athlete and coalesce(public.is_group_member(p_group), false))
    ) then
      raise exception 'not authorized';
    end if;
  end if;
  perform set_config('app.flagging_unclear', '1', true);

  with sets as (
    select sl.id, sl.session_exercise_id, se.exercise_name, sl.set_order, sl.weight, sl.reps,
           sl.time_seconds, sl.distance, sl.height, sl.data_flag,
           (s.is_historical or sl.is_historical) as historical
    from public.set_logs sl
    join public.session_exercises se on se.id = sl.session_exercise_id
    join public.athlete_sessions s on s.id = se.session_id
    where s.athlete_id = p_athlete and s.group_id = p_group and sl.status = 'completed'
  ),
  usual as (
    select exercise_name,
           percentile_cont(0.5) within group (order by weight) as median,
           count(*) as n,
           avg(case when reps > 0 then 1.0 else 0.0 end) as rep_share
    from sets
    where weight > 0 and (data_flag is null or data_flag = 'accepted')
    group by exercise_name
  ),
  judged as (
    select st.id,
           case
             when st.reps > 100 then 'Reps over 100'
             when st.weight > 0 and coalesce(st.reps, 0) = 0 and st.time_seconds is null and st.distance is null and st.height is null
                  and coalesce(u.rep_share, 0) >= 0.5 then 'Weight but no reps'
             when st.weight > 0 and u.n >= 5 and st.weight >= 8 * u.median then 'Weight far above the usual for this exercise'
             when st.weight > 0 and o.n >= 2 and st.set_order = o.last_order_all and st.weight < 0.25 * o.min_weight and o.min_weight >= 0.75 * o.max_weight
               then 'Last set far below the others'
             else null
           end as reason
    from sets st
    left join usual u on u.exercise_name = st.exercise_name
    left join lateral (
      select count(*) as n, min(x.weight) as min_weight, max(x.weight) as max_weight,
             (select max(y.set_order) from sets y where y.session_exercise_id = st.session_exercise_id) as last_order_all
      from sets x
      where x.session_exercise_id = st.session_exercise_id and x.id <> st.id and x.weight > 0
    ) o on true
    where st.historical and st.data_flag is null
  )
  update public.set_logs sl
    set data_flag = 'unclear', data_flag_reason = j.reason
  from judged j
  where sl.id = j.id and j.reason is not null and sl.data_flag is null;

  get diagnostics v_count = row_count;
  perform set_config('app.flagging_unclear', '', true);
  return v_count;
end;
$$;

revoke all on function public.flag_unclear_sets(uuid, uuid) from public, anon;
grant execute on function public.flag_unclear_sets(uuid, uuid) to authenticated;

-- The coach decides: count the point (true) or leave it out of the numbers again (false). Only a point that carries a mark can be changed.
create or replace function public.set_unclear_point_counted(p_set uuid, p_counts boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group uuid;
begin
  select s.group_id into v_group
  from public.set_logs sl
  join public.session_exercises se on se.id = sl.session_exercise_id
  join public.athlete_sessions s on s.id = se.session_id
  where sl.id = p_set;
  if v_group is null then
    raise exception 'not found';
  end if;
  if auth.uid() is not null and auth.role() <> 'service_role' then
    if not coalesce(public.is_group_coach(v_group), false) or not coalesce(public.group_in_active_org(v_group), false) then
      raise exception 'not authorized';
    end if;
  end if;
  update public.set_logs
    set data_flag = case when p_counts then 'accepted' else 'unclear' end
  where id = p_set and data_flag is not null;
end;
$$;

revoke all on function public.set_unclear_point_counted(uuid, boolean) from public, anon;
grant execute on function public.set_unclear_point_counted(uuid, boolean) to authenticated;

-- One-time backfill: every client who has imported history.
do $$
declare
  r record;
begin
  for r in select distinct s.athlete_id, s.group_id from public.athlete_sessions s where s.is_historical loop
    perform public.flag_unclear_sets(r.athlete_id, r.group_id);
  end loop;
end;
$$;
