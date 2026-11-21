-- Step 219 (Ron, Nov 20: wave 3, the builder and clients). Additions only, and three LIVE functions changed in place (each change found exactly once, or nothing is changed):
--   1. Section headers inside a workout (B3): workout_notes.is_header (default false). A header is a day note marked as one, so it moves, renames and deletes like a note.
--      duplicate_program (LIVE, in place) copies it, so Assign, Duplicate and Make a template keep headers. Every existing note stays a note.
--   2. How long one-on-one clients stay (R4): business_client_tenure(group ids), dates only, for the Business page. A coach gets their own clients; an owner or admin of the organization
--      gets the organization's, except a client marked private from the organization (as the rest of the Business page).
--   3. "Every week from here on" (B4, B5): swap_exercise_every_week replaces an exercise in the same slot of each later week of its program (the same day of the week; the same progression
--      slot when it has one, else the same place in the day), only where that slot still holds the same exercise, keeping each week's own sets, reps, set types, percent of max and its
--      progression rule. The coach of the group may; so may a client on their OWN one-on-one program (never a team or group program). Each change is recorded (program_exercise_swaps)
--      and undo_exercise_swap puts back exactly what it changed (a row edited since is left alone) and says which. When a client does it, the group's coaches get a notice
--      (exercise_swap, written here, so no way of calling it skips the notice).
--   4. A new notice type, exercise_swap (a client changed an exercise for every week), under "Client activity": notifications_type_check widened from the live one, and notice_kind_of
--      (LIVE, in place) gets that one line.
-- Re-running is safe.

-- ---- 1. section headers --------------------------------------------------------------------------------------------------------------------------------------------------------
alter table public.workout_notes add column if not exists is_header boolean not null default false;

do $dup$
declare
  v_def text := replace(pg_get_functiondef('public.duplicate_program(uuid, uuid, uuid, uuid, text, date)'::regprocedure), E'\r\n', E'\n');
  v_pairs constant text[][] := array[
    array['insert into public.workout_notes (workout_id, group_id, body, position, created_by)', 'insert into public.workout_notes (workout_id, group_id, body, position, created_by, is_header)'],
    array['select v_new_w, p_destination_group_id, body, position, v_by', 'select v_new_w, p_destination_group_id, body, position, v_by, is_header']
  ];
  i int;
begin
  if position('is_header' in v_def) > 0 then
    return; -- already changed (re-run)
  end if;
  for i in 1 .. array_length(v_pairs, 1) loop
    if (length(v_def) - length(replace(v_def, v_pairs[i][1], ''))) / length(v_pairs[i][1]) <> 1 then
      raise exception 'duplicate_program does not hold "%" exactly once; NOTHING was changed.', v_pairs[i][1];
    end if;
  end loop;
  for i in 1 .. array_length(v_pairs, 1) loop
    v_def := replace(v_def, v_pairs[i][1], v_pairs[i][2]);
  end loop;
  execute v_def;
end
$dup$;

-- ---- 2. how long one-on-one clients stay ---------------------------------------------------------------------------------------------------------------------------------------
create or replace function public.business_client_tenure(p_group_ids uuid[])
returns table (athlete_id uuid, group_id uuid, joined_at timestamptz, removed_at timestamptz, last_active timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  with mine as (
    -- one-on-one spaces the caller coaches, or that are in an organization the caller owns or runs
    select g.id, public.is_group_coach(g.id) as coaches
    from public.groups g
    where g.id = any (p_group_ids)
      and g.group_kind = 'one_on_one'
      and (public.is_group_coach(g.id) or g.id in (select public.my_admin_group_ids()))
  ),
  spans as (
    select m.profile_id as athlete_id, m.group_id, m.joined_at, null::timestamptz as removed_at
    from public.group_memberships m
    join mine on mine.id = m.group_id
    where m.role = 'athlete' and (mine.coaches or not coalesce(m.private_from_org, false))
    union all
    select r.athlete_id, r.group_id, nullif(r.membership ->> 'joined_at', '')::timestamptz, r.removed_at
    from public.client_removals r
    join mine on mine.id = r.group_id
    where r.restored_at is null and r.purged_at is null
      and (mine.coaches or not coalesce((r.membership ->> 'private_from_org')::boolean, false))
  )
  select s.athlete_id, s.group_id, s.joined_at, s.removed_at,
    greatest(
      (select max(l.created_at) from public.workout_logs l where l.group_id = s.group_id and l.athlete_id = s.athlete_id),
      (select max(b.start_at) from public.bookings b where b.group_id = s.group_id and b.athlete_id = s.athlete_id and b.status = 'confirmed' and not coalesce(b.no_show, false) and b.start_at <= now())
    ) as last_active
  from spans s
  where auth.uid() is not null
  order by s.athlete_id, s.group_id, s.joined_at
$$;
revoke all on function public.business_client_tenure(uuid[]) from public, anon;
grant execute on function public.business_client_tenure(uuid[]) to authenticated;

-- ---- 3. every week from here on ------------------------------------------------------------------------------------------------------------------------------------------------
create table if not exists public.program_exercise_swaps (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references public.programs(id) on delete cascade,
  group_id uuid not null references public.groups(id) on delete cascade,
  source_exercise_id uuid,
  from_name text not null,
  to_name text not null,
  -- every exercise changed, as it was: [{id, exercise_name, display_name}]
  changes jsonb not null default '[]'::jsonb,
  -- what happened to the progression rule: 'moved' (renamed with it), 'copied' (the new name got a copy, the old weeks kept theirs) or null
  progression text,
  slot text not null default '',
  by_user uuid references public.profiles(id) on delete set null,
  by_client boolean not null default false,
  created_at timestamptz not null default now(),
  undone_at timestamptz
);
create index if not exists program_exercise_swaps_program_idx on public.program_exercise_swaps (program_id, created_at desc);
alter table public.program_exercise_swaps enable row level security;
revoke all on public.program_exercise_swaps from anon, authenticated;
grant select on public.program_exercise_swaps to authenticated;
drop policy if exists "program_exercise_swaps_read" on public.program_exercise_swaps;
create policy "program_exercise_swaps_read" on public.program_exercise_swaps for select to authenticated using (public.is_group_coach(group_id) or by_user = (select auth.uid()));

-- p_dry_run: only say how many later weeks would change (nothing is written).
create or replace function public.swap_exercise_every_week(p_exercise uuid, p_new_name text, p_display_name text default null, p_dry_run boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  me uuid := auth.uid();
  v_src public.group_workout_exercises%rowtype;
  v_w public.workouts%rowtype;
  v_prog public.programs%rowtype;
  v_kind text;
  v_name text := btrim(coalesce(p_new_name, ''));
  v_disp text := nullif(btrim(coalesce(p_display_name, '')), '');
  v_slot text;
  v_pos int;
  v_by_client boolean;
  v_targets uuid[];
  v_weeks int[];
  v_changes jsonb;
  v_swap uuid;
  v_prog_note text;
  v_rule public.exercise_progressions%rowtype;
  v_who text;
begin
  if me is null then
    raise exception 'not authorized';
  end if;
  if char_length(v_name) = 0 or char_length(v_name) > 120 then
    raise exception 'an exercise name is needed';
  end if;
  if v_disp is not null and char_length(v_disp) > 120 then
    v_disp := null;
  end if;
  select * into v_src from public.group_workout_exercises where id = p_exercise for update;
  if not found then
    raise exception 'exercise not found';
  end if;
  select * into v_w from public.workouts where id = v_src.workout_id;
  if v_w.program_id is null or v_w.week_number is null then
    raise exception 'not a program day';
  end if;
  select * into v_prog from public.programs where id = v_w.program_id;
  select group_kind into v_kind from public.groups where id = v_src.group_id;
  if public.is_group_coach(v_src.group_id) then
    v_by_client := false;
  elsif v_kind = 'one_on_one'
    and not coalesce(v_prog.org_program, false)
    and (v_prog.athlete_id = me or v_prog.athlete_id is null)
    and v_src.athlete_id is not distinct from v_prog.athlete_id
    and exists (select 1 from public.group_memberships m where m.group_id = v_src.group_id and m.profile_id = me and m.role = 'athlete') then
    v_by_client := true;
  else
    raise exception 'not authorized';
  end if;
  if coalesce(v_src.is_slot, false) then
    raise exception 'a template slot is chosen when the template is assigned';
  end if;
  if v_name = v_src.exercise_name and v_disp is not distinct from v_src.display_name then
    return jsonb_build_object('swap', null, 'changed', 0, 'weeks', '[]'::jsonb);
  end if;

  v_slot := coalesce(v_src.progression_slot, '');
  -- the source's place in its day (template slots are not places)
  select x.rn into v_pos
  from (
    select e.id, row_number() over (order by e.exercise_order, e.id) as rn
    from public.group_workout_exercises e
    where e.workout_id = v_src.workout_id and e.athlete_id is not distinct from v_src.athlete_id and not coalesce(e.is_slot, false)
  ) x
  where x.id = v_src.id;

  with later as (
    select w.id as wid, w.week_number
    from public.workouts w
    where w.program_id = v_w.program_id and w.week_number > v_w.week_number and w.day_index = v_w.day_index
  ),
  ranked as (
    select e.id, e.exercise_name, coalesce(e.progression_slot, '') as pslot, l.week_number,
      row_number() over (partition by e.workout_id order by e.exercise_order, e.id) as rn
    from public.group_workout_exercises e
    join later l on l.wid = e.workout_id
    where e.athlete_id is not distinct from v_src.athlete_id and not coalesce(e.is_slot, false)
  )
  select coalesce(array_agg(r.id order by r.week_number, r.id), '{}'), coalesce(array_agg(distinct r.week_number), '{}')
  into v_targets, v_weeks
  from ranked r
  where r.exercise_name = v_src.exercise_name
    and (case when v_slot <> '' then r.pslot = v_slot else r.rn = v_pos end);

  if p_dry_run then
    return jsonb_build_object('swap', null, 'changed', coalesce(array_length(v_targets, 1), 0), 'weeks', to_jsonb(v_weeks));
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'exercise_name', e.exercise_name, 'display_name', e.display_name)), '[]'::jsonb)
  into v_changes
  from public.group_workout_exercises e
  where e.id = v_src.id or e.id = any (v_targets);

  update public.group_workout_exercises e set exercise_name = v_name, display_name = v_disp
  where e.id = v_src.id or e.id = any (v_targets);

  -- the progression rule goes with the exercise; when earlier weeks keep the old name, they keep theirs and the new name gets a copy
  if v_src.exercise_name <> v_name then
    select * into v_rule from public.exercise_progressions where program_id = v_w.program_id and exercise_name = v_src.exercise_name and slot = v_slot;
    if found and not exists (select 1 from public.exercise_progressions where program_id = v_w.program_id and exercise_name = v_name and slot = v_slot) then
      if exists (
        select 1 from public.group_workout_exercises e join public.workouts w on w.id = e.workout_id
        where w.program_id = v_w.program_id and e.exercise_name = v_src.exercise_name and coalesce(e.progression_slot, '') = v_slot
      ) then
        insert into public.exercise_progressions (program_id, group_id, exercise_name, model, config, created_by, tier_label, slot)
        values (v_rule.program_id, v_rule.group_id, v_name, v_rule.model, v_rule.config, me, v_rule.tier_label, v_slot);
        v_prog_note := 'copied';
      else
        update public.exercise_progressions set exercise_name = v_name, updated_at = now() where id = v_rule.id;
        v_prog_note := 'moved';
      end if;
    end if;
  end if;

  insert into public.program_exercise_swaps (program_id, group_id, source_exercise_id, from_name, to_name, changes, progression, slot, by_user, by_client)
  values (v_w.program_id, v_src.group_id, v_src.id, v_src.exercise_name, v_name, v_changes, v_prog_note, v_slot, me, v_by_client)
  returning id into v_swap;

  -- a client's change tells the group's coaches (the bell; the push goes from the app), with the program to open, where it can be undone
  if v_by_client then
    select coalesce(nullif(btrim(full_name), ''), 'Your client') into v_who from public.profiles where id = me;
    insert into public.notifications (profile_id, group_id, type, body, link_path)
    select m.profile_id, v_src.group_id, 'exercise_swap',
      coalesce(v_who, 'Your client') || ' swapped ' || v_src.exercise_name || ' for ' || v_name || ' for every week.',
      '/groups/' || v_src.group_id || '/programs/' || v_w.program_id || '?swap=' || v_swap
    from public.group_memberships m
    where m.group_id = v_src.group_id and m.role = 'coach' and m.profile_id <> me;
  end if;

  return jsonb_build_object('swap', v_swap, 'changed', coalesce(array_length(v_targets, 1), 0), 'weeks', to_jsonb(v_weeks), 'program', v_w.program_id, 'group', v_src.group_id,
    'byClient', v_by_client, 'from', v_src.exercise_name, 'to', v_name, 'ids', to_jsonb(v_targets));
end
$function$;
revoke all on function public.swap_exercise_every_week(uuid, text, text, boolean) from public, anon;
grant execute on function public.swap_exercise_every_week(uuid, text, text, boolean) to authenticated;

-- The builder's question asks first how many later weeks would change: the same function run dry, under a name the app counts as a read (so asking never refreshes other panes).
create or replace function public.preview_exercise_every_week(p_exercise uuid, p_new_name text, p_display_name text default null)
returns jsonb
language sql
volatile
set search_path = public
as $$
  select public.swap_exercise_every_week(p_exercise, p_new_name, p_display_name, true)
$$;
revoke all on function public.preview_exercise_every_week(uuid, text, text) from public, anon;
grant execute on function public.preview_exercise_every_week(uuid, text, text) to authenticated;

-- Puts back what one swap changed (only the coach of the group). A row changed again since (no longer the swapped-in name) is left as it is. Returns which were put back, each as
-- it now is: {"restored": n, "rows": [{id, exercise_name, display_name}]}.
create or replace function public.undo_exercise_swap(p_swap uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v public.program_exercise_swaps%rowtype;
  v_rows jsonb;
begin
  if auth.uid() is null then
    raise exception 'not authorized';
  end if;
  select * into v from public.program_exercise_swaps where id = p_swap for update;
  if not found then
    raise exception 'swap not found';
  end if;
  if not public.is_group_coach(v.group_id) then
    raise exception 'not authorized';
  end if;
  if v.undone_at is not null then
    return jsonb_build_object('restored', 0, 'rows', '[]'::jsonb);
  end if;
  with back as (
    update public.group_workout_exercises e
    set exercise_name = c ->> 'exercise_name', display_name = c ->> 'display_name'
    from jsonb_array_elements(v.changes) c
    where e.id = (c ->> 'id')::uuid and e.exercise_name = v.to_name
    returning jsonb_build_object('id', e.id, 'exercise_name', e.exercise_name, 'display_name', e.display_name) as r
  )
  select coalesce(jsonb_agg(r), '[]'::jsonb) into v_rows from back;
  if v.progression = 'copied' then
    delete from public.exercise_progressions where program_id = v.program_id and exercise_name = v.to_name and slot = v.slot;
  elsif v.progression = 'moved' and not exists (select 1 from public.exercise_progressions where program_id = v.program_id and exercise_name = v.from_name and slot = v.slot) then
    update public.exercise_progressions set exercise_name = v.from_name, updated_at = now() where program_id = v.program_id and exercise_name = v.to_name and slot = v.slot;
  end if;
  update public.program_exercise_swaps set undone_at = now() where id = v.id;
  return jsonb_build_object('restored', jsonb_array_length(v_rows), 'rows', v_rows);
end
$function$;
revoke all on function public.undo_exercise_swap(uuid) from public, anon;
grant execute on function public.undo_exercise_swap(uuid) to authenticated;

-- ---- 4. the notice type ---------------------------------------------------------------------------------------------------------------------------------------------------------
do $types$
declare
  v_def text;
  v_have text[];
  v_all text[];
begin
  select pg_get_constraintdef(c.oid) into v_def from pg_constraint c where c.conname = 'notifications_type_check' and c.conrelid = 'public.notifications'::regclass;
  if v_def is null then
    raise exception 'notifications_type_check was not found, so the notification types cannot be widened. NOTHING was changed.';
  end if;
  if position('''exercise_swap''' in v_def) > 0 then
    return; -- already there (re-run)
  end if;
  select array_agg(m[1]) into v_have from regexp_matches(v_def, '''([a-z_]+)''', 'g') as m;
  select array_agg(distinct t order by t) into v_all from unnest(v_have || array['exercise_swap']) as t;
  alter table public.notifications drop constraint notifications_type_check;
  execute format('alter table public.notifications add constraint notifications_type_check check (type = any (array[%s]))', (select string_agg(quote_literal(t), ', ') from unnest(v_all) as t));
end
$types$;

do $kind$
declare
  v_def text := replace(pg_get_functiondef('public.notice_kind_of(text)'::regprocedure), E'\r\n', E'\n');
  v_old constant text := E'    when ''weekly_checkin'' then ''client_activity''\n';
  v_new constant text := E'    when ''weekly_checkin'' then ''client_activity''\n    when ''exercise_swap'' then ''client_activity''\n';
begin
  if position('''exercise_swap''' in v_def) > 0 then
    return; -- already changed (re-run)
  end if;
  if (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 1 then
    raise exception 'notice_kind_of does not hold its weekly_checkin line exactly once; NOTHING was changed.';
  end if;
  execute replace(v_def, v_old, v_new);
end
$kind$;
