-- RELEASE AC (AI BUILDER: A PROGRAM THE AI BUILDS IS A DRAFT UNTIL THE COACH SIGNS IT OFF): ONE paste. Steps 70 in order, all or nothing.
--
-- Paste this whole file into the Supabase SQL editor and run it once. It replaces the separate precheck and apply files for these steps (they stay as the fallback).
-- Every check from each step's precheck is built in as a guard in front of that step. If any check is false, the run stops with a message that names the step and the
-- failed check, and NOTHING is kept, so a second run after a refusal is safe.
-- WHAT YOU SHOULD SEE: first "Success" for the transaction, then a result table with one row per step and in_place = true on every row.
-- ON ERROR: run   rollback;   once, copy the red text, send it to Spot. Do not run it again.
-- AFTER STEP 70: Nothing changes for any existing program. Programs the AI builds from now on are saved as drafts and only go live when the coach presses Sign off and make active.
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

-- ===== Release AC (AI builder: a program the AI builds is a draft until the coach signs it off), step 70: 0324 AI builder safety: a program the AI builds is a draft (not active, and hidden from clients at the database level) until the coach signs it off; no path can make an unsigned draft live, and a copy of a draft is a draft
do $g70$
declare
  failed text;
begin
  select string_agg(check_name, '; ') into failed from (
    values
      ('0324 is not already applied (programs has no ai_draft column yet)', not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'programs' and column_name = 'ai_draft')),
      ('the program copy function exists (0318)', exists (select 1 from pg_proc where proname = 'duplicate_program' and pronamespace = 'public'::regnamespace))
  ) as checks(check_name, ok) where not ok;
  if failed is not null then
    raise exception 'Release AC (AI builder: a program the AI builds is a draft until the coach signs it off), step 70 (0324) cannot run: this step looks already applied, or the database is not in the state it expects. Failed checks: %. NOTHING was changed (the whole bundle is all or nothing). If an earlier step was applied by hand, use the single-step files for the rest, and send Spot this message.', failed;
  end if;
end
$g70$;

-- ====================================================================================================
-- migration 0324_ai_draft_programs.sql
-- ====================================================================================================

-- Stage 1 of the AI builder: nothing AI-built goes live until the coach signs it off.
--
--   * programs.ai_draft: true for a program the AI built that the coach has not yet signed off. The builder now saves AI programs as drafts (not active, not seen by any client).
--   * A guard: a program can never be active while it is still an unsigned draft. Signing off is ONE update that clears ai_draft and sets is_active (the coach's "Sign off and make active"),
--     so no screen, copy, assignment or webhook can make an unsigned draft live, even by mistake.
--   * duplicate_program (the copy made by Assign, bulk assign, package enrolment and the Stripe webhook) copies ai_draft and makes the copy active only if the source was signed off. A copy of a
--     draft is a draft. The rest of the function is the live text, unchanged.
-- Nothing changes for any existing program (every row starts with ai_draft = false). Requires 0318.

alter table public.programs add column if not exists ai_draft boolean not null default false;

create or replace function public.guard_ai_draft_not_active()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.ai_draft and new.is_active then
    raise exception 'an AI draft program must be signed off before it can be made active';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_ai_draft_not_active() from public, anon, authenticated;

drop trigger if exists programs_guard_ai_draft on public.programs;
create trigger programs_guard_ai_draft
  before insert or update of is_active, ai_draft on public.programs
  for each row execute function public.guard_ai_draft_not_active();

create or replace function public.duplicate_program(
  p_source_program_id uuid,
  p_destination_group_id uuid,
  p_created_by uuid default null,
  p_athlete_id uuid default null,
  p_client_name text default null,
  p_start_date date default null
)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  src public.programs%rowtype;
  v_by uuid := coalesce(p_created_by, auth.uid());
  v_new uuid;
  w record;
  e record;
  v_new_w uuid;
  v_new_e uuid;
  v_name text;
  v_tail text := ' ' || chr(8212) || ' ';
begin
  if v_by is null then
    raise exception 'created_by is required';
  end if;

  select * into src from public.programs where id = p_source_program_id;
  if not found then
    raise exception 'Source program not found.';
  end if;

  -- The copy's name. A copy for a client is "Program - Client". When the source is itself a client's copy ("Program - Alice") its old client tail is dropped first, so assigning it to Bob gives
  -- "Program - Bob", not "Program - Alice - Bob"; and a name that already ends with this client's name is left as it is, so assigning twice never repeats it.
  v_name := src.name;
  if p_client_name is not null and length(trim(p_client_name)) > 0 then
    if right(v_name, length(v_tail || trim(p_client_name))) <> v_tail || trim(p_client_name) then
      if src.athlete_id is not null then
        v_name := regexp_replace(v_name, ' ' || chr(8212) || ' [^' || chr(8212) || ']*$', '');
      end if;
      v_name := v_name || v_tail || trim(p_client_name);
    end if;
  end if;

  insert into public.programs (
    group_id, name, description, created_by, athlete_id, is_active,
    start_date, training_days, visibility_window, training_intent,
    cover_image_path, ai_sequencing_notes, source_program_id, ai_draft
  )
  values (
    p_destination_group_id,
    v_name,
    src.description,
    v_by,
    p_athlete_id,
    not src.ai_draft,
    coalesce(p_start_date, src.start_date),
    src.training_days,
    src.visibility_window,
    src.training_intent,
    case when p_destination_group_id = src.group_id then src.cover_image_path else null end,
    src.ai_sequencing_notes,
    p_source_program_id,
    src.ai_draft
  )
  returning id into v_new;

  insert into public.exercise_progressions (
    program_id, group_id, exercise_name, model, config, tier_label, created_by
  )
  select v_new, p_destination_group_id, exercise_name, model, config, tier_label, v_by
  from public.exercise_progressions
  where program_id = p_source_program_id;

  for w in
    select * from public.workouts
    where program_id = p_source_program_id
    order by week_number, day_index
  loop
    insert into public.workouts (program_id, group_id, title, week_number, day_index, notes)
    values (v_new, p_destination_group_id, w.title, w.week_number, w.day_index, w.notes)
    returning id into v_new_w;

    for e in
      select * from public.group_workout_exercises
      where workout_id = w.id
      order by exercise_order
    loop
      insert into public.group_workout_exercises (
        workout_id, group_id, exercise_name, exercise_order, movement_pattern_id, tracked_fields, notes, display_name
      )
      values (
        v_new_w, p_destination_group_id, e.exercise_name, e.exercise_order,
        e.movement_pattern_id, e.tracked_fields, e.notes, e.display_name
      )
      returning id into v_new_e;

      insert into public.group_workout_exercise_sets (
        group_workout_exercise_id, set_order, target_reps, target_weight, target_rpe, target_rir,
        target_tempo, target_time_seconds, target_height, target_distance, rep_min, rep_max,
        target_rest_seconds, target_pace
      )
      select
        v_new_e, set_order, target_reps, target_weight, target_rpe, target_rir,
        target_tempo, target_time_seconds, target_height, target_distance, rep_min, rep_max,
        target_rest_seconds, target_pace
      from public.group_workout_exercise_sets
      where group_workout_exercise_id = e.id
      order by set_order;
    end loop;

    insert into public.workout_notes (workout_id, group_id, body, position, created_by)
    select v_new_w, p_destination_group_id, body, position, v_by
    from public.workout_notes
    where workout_id = w.id
    order by position;
  end loop;

  return v_new;
end;
$$;

-- ---- an unsigned AI draft is hidden from everyone but the coaches of its group ---------------------------------------------------------
-- Until now only the screens hid a draft (they show active programs); a client the draft was built for could still read it through the database. Now the database itself hides a draft
-- program, its workouts, exercises, sets, notes and progressions from members who are not coaches of the group. Coaches of the group (and the organization's owner and admins, through
-- the read rules they already have on exercises and sets) read it as before, so copying, assigning and signing off work unchanged. After sign-off everything is visible exactly as before.
create or replace function public.is_ai_draft_program(_program_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select p.ai_draft from public.programs p where p.id = _program_id), false);
$$;
revoke all on function public.is_ai_draft_program(uuid) from public, anon;
grant execute on function public.is_ai_draft_program(uuid) to authenticated;

create or replace function public.is_ai_draft_workout(_workout_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select p.ai_draft from public.workouts w join public.programs p on p.id = w.program_id where w.id = _workout_id), false);
$$;
revoke all on function public.is_ai_draft_workout(uuid) from public, anon;
grant execute on function public.is_ai_draft_workout(uuid) to authenticated;

drop policy "programs_select_members" on public.programs;
create policy "programs_select_members" on public.programs for select
  to authenticated using (
    is_group_member(group_id)
    and (athlete_id is null or athlete_id = (select auth.uid()) or is_group_coach(group_id))
    and (is_group_coach(group_id) or not ai_draft)
  );

drop policy "workouts_select_members" on public.workouts;
create policy "workouts_select_members" on public.workouts for select
  to authenticated using (
    is_group_member(group_id)
    and (athlete_id is null or athlete_id = (select auth.uid()) or is_group_coach(group_id))
    and (is_group_coach(group_id) or not public.is_ai_draft_program(program_id))
  );

drop policy "workout_notes_select_members" on public.workout_notes;
create policy "workout_notes_select_members" on public.workout_notes for select
  to authenticated using (
    is_group_member(group_id)
    and (athlete_id is null or athlete_id = (select auth.uid()) or is_group_coach(group_id))
    and (is_group_coach(group_id) or not public.is_ai_draft_workout(workout_id))
  );

drop policy "exercise_progressions_select_members" on public.exercise_progressions;
create policy "exercise_progressions_select_members" on public.exercise_progressions for select
  to authenticated using (
    public.is_group_member(group_id)
    and (public.is_group_coach(group_id) or not public.is_ai_draft_program(program_id))
  );

-- The exercises and sets already ask this function for everyone who is not a coach of the group (content-dripping); a draft now answers no.
create or replace function public.is_workout_visible_to_athlete(target_workout_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_program_id uuid;
  v_week_number int;
  v_day_index int;
  v_start_date date;
  v_training_days smallint[];
  v_visibility_window text;
  v_ordinal int;
  v_cursor date;
  v_matched int := 0;
  v_scheduled_date date;
  v_window_days int;
begin
  select w.program_id, w.week_number, w.day_index
  into v_program_id, v_week_number, v_day_index
  from public.workouts w where w.id = target_workout_id;

  if v_program_id is null then
    return true;
  end if;

  if public.is_ai_draft_program(v_program_id) then
    return false;
  end if;

  select p.start_date, p.training_days, coalesce(p.visibility_window, 'day')
  into v_start_date, v_training_days, v_visibility_window
  from public.programs p where p.id = v_program_id;

  if v_start_date is null or v_training_days is null or array_length(v_training_days, 1) is null then
    return true;
  end if;

  if v_visibility_window = 'full' then
    return true;
  end if;

  select count(*) into v_ordinal
  from public.workouts w2
  where w2.program_id = v_program_id
    and (w2.week_number, w2.day_index) <= (v_week_number, v_day_index);

  v_cursor := v_start_date;
  while v_matched < v_ordinal loop
    if extract(dow from v_cursor)::int = any(v_training_days) then
      v_matched := v_matched + 1;
      exit when v_matched = v_ordinal;
    end if;
    v_cursor := v_cursor + 1;
  end loop;
  v_scheduled_date := v_cursor;

  v_window_days := case v_visibility_window
    when 'week' then 7
    when 'month' then 30
    else 0
  end;

  return v_scheduled_date <= (current_date + v_window_days);
end;
$$;

commit;

-- Read-only result (after the commit): every row must say in_place = true.
select step, what, in_place from (
  select 'step 70 (0324)' as step, '0324 AI builder safety: a program the AI builds is a draft' as what, not ((not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'programs' and column_name = 'ai_draft'))) as in_place
) as result order by step;
