-- Release CD: a coach can ask the client to count a record from imported history as a real one ("your 900 lb deadlift from March 2025"); when the client says yes, it behaves like any other record
-- with its ORIGINAL date.
--
--   * pr_promotions: one row per imported workout and exercise that was asked about (who asked, the weight, asked / agreed / declined, when). The coach who asked and the client can read it; nobody
--     writes it directly (only the two functions below).
--   * ask_pr_promotion(session, exercise): a coach of the client's group. Only an imported workout that has no workout log, and only an exercise with a counted weight in it. One open ask per record;
--     after a "Not now" the coach can ask again only after 30 days. The client gets one notification.
--   * answer_pr_promotion(promotion, accept): the client only. Yes gives that one imported workout a real workout log dated when the workout was done (volume and sets from its counted sets, the
--     exercise listed as a record), so every place that reads workout logs (records, feed, share card, recaps, dashboards) treats it as a normal record from then on. The imported workout counts
--     as a workout too: a log is per workout. Other records asked about in the same workout are covered by the same log. No: nothing changes.
--   * Backdated workout logs never bring an inactive client back: the "client came back" rule now ignores a log dated more than a day ago.
--   * Notification type 'pr_promotion', added to the list the database already has.
-- Re-runnable.

do $types$
declare
  v_def text;
  v_have text[];
  v_all text[];
  v_new_def text;
  v_after int;
begin
  select pg_get_constraintdef(c.oid) into v_def
  from pg_constraint c
  where c.conname = 'notifications_type_check' and c.conrelid = 'public.notifications'::regclass;
  if v_def is null then
    raise exception 'notifications_type_check was not found, so the notification types cannot be widened. NOTHING was changed.';
  end if;
  select coalesce(array_agg(m[1] order by m[1]), '{}') into v_have from regexp_matches(v_def, '''([^'']+)''::text', 'g') as m;
  if coalesce(cardinality(v_have), 0) < 5 then
    raise exception 'Could not read the existing notification types from the live constraint (%). NOTHING was changed.', v_def;
  end if;
  select array_agg(distinct t order by t) into v_all from unnest(v_have || array['pr_promotion']) as t;
  alter table public.notifications drop constraint notifications_type_check;
  execute format(
    'alter table public.notifications add constraint notifications_type_check check (type = any (array[%s]))',
    (select string_agg(quote_literal(t) || '::text', ', ') from unnest(v_all) as t)
  );
  select pg_get_constraintdef(c.oid) into v_new_def from pg_constraint c where c.conname = 'notifications_type_check' and c.conrelid = 'public.notifications'::regclass;
  select count(*) into v_after from regexp_matches(v_new_def, '''([^'']+)''::text', 'g');
  if v_after <> cardinality(v_all) or cardinality(v_all) < cardinality(v_have) or exists (select 1 from unnest(v_have) t where t <> all (v_all)) then
    raise exception 'The rebuilt notification type list does not match the live one (% before, % after). NOTHING was changed.', cardinality(v_have), v_after;
  end if;
end
$types$;

create table if not exists public.pr_promotions (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references public.profiles(id) on delete cascade,
  group_id uuid not null references public.groups(id) on delete cascade,
  session_id uuid not null references public.athlete_sessions(id) on delete cascade,
  exercise_name text not null,
  weight numeric not null,
  requested_by uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'asked' check (status in ('asked', 'agreed', 'declined')),
  asked_at timestamptz not null default now(),
  answered_at timestamptz,
  workout_log_id uuid references public.workout_logs(id) on delete set null,
  unique (session_id, exercise_name)
);
create index if not exists pr_promotions_athlete_idx on public.pr_promotions (athlete_id, group_id);
alter table public.pr_promotions enable row level security;
revoke all on public.pr_promotions from anon;
drop policy if exists "pr_promotions_read" on public.pr_promotions;
create policy "pr_promotions_read" on public.pr_promotions for select to authenticated
  using (athlete_id = (select auth.uid()) or (requested_by = (select auth.uid()) and public.is_group_coach(group_id)));

do $$
begin
  if to_regprocedure('public.group_in_active_org(uuid)') is not null
     and not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'pr_promotions' and policyname = 'org_wall_header') then
    create policy "org_wall_header" on public.pr_promotions as restrictive for all to authenticated
      using (public.group_in_active_org(group_id))
      with check (public.group_in_active_org(group_id));
  end if;
end;
$$;

create or replace function public.ask_pr_promotion(p_session uuid, p_exercise text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_s record;
  v_weight numeric;
  v_row record;
  v_id uuid;
  v_text text;
begin
  select s.id, s.athlete_id, s.group_id, s.is_historical, s.status, coalesce(s.completed_at, s.started_at) as at
    into v_s from public.athlete_sessions s where s.id = p_session;
  if not found then
    raise exception 'not found';
  end if;
  if auth.uid() is null or not coalesce(public.is_group_coach(v_s.group_id), false) or not coalesce(public.group_in_active_org(v_s.group_id), false) then
    raise exception 'not authorized';
  end if;
  if not v_s.is_historical or v_s.status <> 'completed' then
    raise exception 'only imported history can be counted this way';
  end if;
  if exists (select 1 from public.workout_logs wl where wl.session_id = p_session) then
    raise exception 'this workout already counts';
  end if;
  select max(sl.weight) into v_weight
  from public.set_logs sl
  join public.session_exercises se on se.id = sl.session_exercise_id
  where se.session_id = p_session and se.exercise_name = p_exercise and sl.status = 'completed' and sl.weight > 0
    and (sl.data_flag is null or sl.data_flag = 'accepted');
  if v_weight is null then
    raise exception 'there is no counted weight for that exercise';
  end if;

  select * into v_row from public.pr_promotions where session_id = p_session and exercise_name = p_exercise;
  if found then
    if v_row.status = 'asked' then
      return v_row.id;
    end if;
    if v_row.status = 'agreed' then
      raise exception 'this record already counts';
    end if;
    if v_row.answered_at > now() - interval '30 days' then
      raise exception 'asked less than 30 days ago';
    end if;
    update public.pr_promotions
      set status = 'asked', asked_at = now(), answered_at = null, requested_by = auth.uid(), weight = v_weight
    where id = v_row.id;
    v_id := v_row.id;
  else
    insert into public.pr_promotions (athlete_id, group_id, session_id, exercise_name, weight, requested_by)
    values (v_s.athlete_id, v_s.group_id, p_session, p_exercise, v_weight, auth.uid())
    returning id into v_id;
  end if;

  v_text := 'Your coach wants to count your '
    || case when v_weight = round(v_weight) then round(v_weight)::text else v_weight::text end
    || ' lb ' || p_exercise || ' from ' || to_char(v_s.at, 'FMMonth YYYY') || ' as a PR.';
  insert into public.notifications (profile_id, group_id, type, body, link_path)
  values (v_s.athlete_id, v_s.group_id, 'pr_promotion', v_text, '/pr-promotion/' || v_id::text);
  return v_id;
end;
$$;

revoke all on function public.ask_pr_promotion(uuid, text) from public, anon;
grant execute on function public.ask_pr_promotion(uuid, text) to authenticated;

-- The client's answer. Returns the workout log id when they said yes (null when they said no).
create or replace function public.answer_pr_promotion(p_id uuid, p_accept boolean)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_p record;
  v_s record;
  v_log uuid;
  v_volume numeric;
  v_sets integer;
  v_names text[];
begin
  select * into v_p from public.pr_promotions where id = p_id for update;
  if not found or auth.uid() is distinct from v_p.athlete_id then
    raise exception 'not found';
  end if;
  if v_p.status <> 'asked' then
    return v_p.workout_log_id;
  end if;
  if not p_accept then
    update public.pr_promotions set status = 'declined', answered_at = now() where id = p_id;
    return null;
  end if;

  select s.id, s.athlete_id, s.group_id, s.workout_id, s.duration_seconds, coalesce(s.completed_at, s.started_at) as at
    into v_s from public.athlete_sessions s where s.id = v_p.session_id;
  select wl.id into v_log from public.workout_logs wl where wl.session_id = v_p.session_id;
  if v_log is null then
    select coalesce(sum(sl.weight * sl.reps) filter (where sl.weight is not null and sl.reps is not null), 0), count(*)::integer
      into v_volume, v_sets
    from public.set_logs sl
    join public.session_exercises se on se.id = sl.session_exercise_id
    where se.session_id = v_p.session_id and sl.status = 'completed' and (sl.data_flag is null or sl.data_flag = 'accepted');
    select array_agg(distinct exercise_name order by exercise_name) into v_names
    from public.pr_promotions where session_id = v_p.session_id and status = 'asked';
    insert into public.workout_logs (session_id, athlete_id, group_id, workout_id, total_volume, total_sets_completed, total_duration_seconds, new_prs, logged_by_coach, created_at)
    values (v_p.session_id, v_s.athlete_id, v_s.group_id, v_s.workout_id, v_volume, v_sets, v_s.duration_seconds, coalesce(v_names, array[v_p.exercise_name]), false, v_s.at)
    returning id into v_log;
  end if;
  update public.pr_promotions
    set status = 'agreed', answered_at = now(), workout_log_id = v_log
  where session_id = v_p.session_id and status = 'asked';
  return v_log;
end;
$$;

revoke all on function public.answer_pr_promotion(uuid, boolean) from public, anon;
grant execute on function public.answer_pr_promotion(uuid, boolean) to authenticated;

-- A workout log dated more than a day ago (a promoted record) is not the client coming back.
create or replace function public.resurface_inactive_client()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_athlete uuid;
  v_group uuid;
begin
  -- The server's own routines (the nightly top-up of a weekly schedule) are not the client coming back.
  if tg_table_name = 'bookings' and auth.role() = 'service_role' then
    return new;
  end if;
  -- A backdated workout log (an imported record the client agreed to count) is history, not activity.
  if tg_table_name = 'workout_logs' and new.created_at < now() - interval '1 day' then
    return new;
  end if;
  if tg_table_name = 'direct_messages' then
    v_athlete := new.sender_id;
  else
    v_athlete := new.athlete_id;
  end if;
  v_group := new.group_id;
  if v_athlete is null then
    return new;
  end if;
  with gone as (delete from public.client_inactive where athlete_id = v_athlete and group_id = v_group returning 1)
  insert into public.client_inactive_events (athlete_id, group_id, event, source)
  select v_athlete, v_group, 'brought_back', 'client_activity' from gone;
  return new;
end;
$function$;
