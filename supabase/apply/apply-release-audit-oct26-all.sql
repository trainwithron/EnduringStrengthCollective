-- RELEASE AUDIT FIXES OCT 26 (IMPORTS MARKED WHILE WRITTEN, SAWYER'S COPY REPAIRED, ORGANIZATION PROGRAMS' DAYS CLOSED TO CLIENTS, TEAM SHEET, ONE SEARCH_PATH, COPIES KEEP SET TYPES): ONE paste. Steps 188 in order, all or nothing.
--
-- Paste this whole file into the Supabase SQL editor and run it once. It replaces the separate precheck and apply files for these steps (they stay as the fallback).
-- Every check from each step's precheck is built in as a guard in front of that step. If any check is false, the run stops with a message that names the step and the
-- failed check, and NOTHING is kept, so a second run after a refusal is safe.
-- WHAT YOU SHOULD SEE: first "Success" for the transaction, then a result table with one row per step and in_place = true on every row.
-- ON ERROR: run   rollback;   once, copy the red text, send it to Spot. Do not run it again.
-- AFTER STEP 188: Sawyer's program has all 8 weeks at once (49 days). Nothing else on screen changes until the app update that goes with it is deployed (deploy it right after; it writes programs.importing).
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

-- ===== Release audit fixes Oct 26 (imports marked while written, Sawyer's copy repaired, organization programs' days closed to clients, team sheet, one search_path, copies keep set types), step 188: 0436 Release audit fixes: an import is marked while it is written; Sawyer Steele's cut-off copy gets its missing days; a client never reads an organization program's days; the team sheet never saves into one; one fixed search_path; a copy keeps each set's type
do $g188$
declare
  failed text;
begin
  select string_agg(check_name, '; ') into failed from (
    values
      ('0436 is not already applied (programs has no importing yet)', not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'programs' and column_name = 'importing')),
      ('Sawyer''s copy is there: Sawyer''s, active, not archived, made from the program', (select count(*) from public.programs where id = '84d908e7-7b92-4143-a1da-b810f120bce6' and athlete_id = '1ba45158-a419-49d4-916a-4807725677ac' and group_id = '11111111-2222-3333-4444-555555555555' and is_active and archived_at is null and source_program_id = '39dc737c-1f7e-43ff-a414-68dda082a1ed') = 1),
      ('Sawyer''s copy still has exactly its 29 days, by id (160 exercises, 435 sets)', (select count(*) from public.workouts where program_id = '84d908e7-7b92-4143-a1da-b810f120bce6') = 29 and (select count(*) from public.workouts where program_id = '84d908e7-7b92-4143-a1da-b810f120bce6' and id in ('b01e0b7c-efca-4648-b68c-1b2a452daecc', '98ddaaef-ae1e-4916-a549-e41e6c6e7e64', '4ebeee75-f643-467b-8fce-778127369de4', '6ae754cb-49be-476a-b39b-98d80ad7c561', '5e4c4c3f-d42d-4071-a065-b0cba433a377', '502722c9-958c-4ce4-a34f-2439d9f06b92', '21dde757-d49d-49ee-be95-cece14fcb339', '51607667-91d3-400a-97ba-bc46d28fa063', '440dd296-d06b-4f84-a62b-e367b28ccade', 'a67f4957-d98a-46a6-a6d6-bc2a381ab447', '3849fb9f-1372-49f0-8b41-b84b66c461ef', '6f926d43-4f42-416f-8c10-0fb6849a222b', '8a31b6bc-a000-45f4-b18b-6fc33fe7f8cb', '0c14ed22-2911-40d9-9a55-bf5e0bad2de3', 'd3f39a2d-90cc-40c5-b7d5-8ae089566ba9', 'd7ea11c9-5dc0-4633-ba6d-46ef4df7921d', '08d2ff98-df09-445f-8118-712335bd6f4c', '79c2dc10-483a-4d2d-a6f5-750b0dc83136', 'd43b7570-d29c-48bc-9bbd-96bb8289dace', 'b2f2ccc0-8b57-4428-af4b-8da6b12de23f', 'e6421ad9-9c67-45d1-a149-9a2aa6a7a04b', '7737ec44-cf76-4a78-94f7-22e0c639fffa', '960628b5-a92f-450d-b6d8-efb68c1e28da', 'b577864d-eadc-42eb-9506-7dc1c7c15ff5', '86159c0f-bde8-45cf-ac25-51d967943b48', '4dc1fbeb-9dfb-47f8-941a-b9d1e24d4c33', '50e7172e-360f-4b65-8bdb-bd68f89e3b9b', 'cffa5008-258c-43c5-b41d-c69236dacba4', '94ecb5f7-c640-402e-b54f-09a3bbd0962f')) = 29 and (select count(*) from public.group_workout_exercises g join public.workouts w on w.id = g.workout_id where w.program_id = '84d908e7-7b92-4143-a1da-b810f120bce6') = 160 and (select count(*) from public.group_workout_exercise_sets s join public.group_workout_exercises g on g.id = s.group_workout_exercise_id join public.workouts w on w.id = g.workout_id where w.program_id = '84d908e7-7b92-4143-a1da-b810f120bce6') = 435),
      ('the program is exactly what the import wrote (49 days, 277 exercises, 714 sets, no notes or rules, the last day at 21:44:57, every day, exercise and set unchanged)', (select count(*) from public.workouts where program_id = '39dc737c-1f7e-43ff-a414-68dda082a1ed') = 49 and (select count(*) from public.group_workout_exercises g join public.workouts w on w.id = g.workout_id where w.program_id = '39dc737c-1f7e-43ff-a414-68dda082a1ed') = 277 and (select count(*) from public.group_workout_exercise_sets s join public.group_workout_exercises g on g.id = s.group_workout_exercise_id join public.workouts w on w.id = g.workout_id where w.program_id = '39dc737c-1f7e-43ff-a414-68dda082a1ed') = 714 and (select count(*) from public.workout_notes n join public.workouts w on w.id = n.workout_id where w.program_id = '39dc737c-1f7e-43ff-a414-68dda082a1ed') = 0 and (select count(*) from public.exercise_progressions where program_id in ('39dc737c-1f7e-43ff-a414-68dda082a1ed', '84d908e7-7b92-4143-a1da-b810f120bce6')) = 0 and (select max(created_at) from public.workouts where program_id = '39dc737c-1f7e-43ff-a414-68dda082a1ed') = '2026-10-26 21:44:57.220386+00'::timestamptz and (select md5(coalesce(string_agg(r, chr(10) order by r), '')) from (select concat_ws('|', w.week_number, w.day_index, w.title, w.notes, w.scheduled_date, e.exercise_order, e.exercise_name, e.tracked_fields::text, e.notes, e.display_name, e.movement_pattern_id, e.is_slot, e.slot_side, e.slot_tier, s.set_order, s.target_reps, s.target_weight, s.target_rpe, s.target_rir, s.target_tempo, s.target_time_seconds, s.target_height, s.target_distance, s.rep_min, s.rep_max, s.target_rest_seconds, s.target_rest_max_seconds, s.target_pace, s.set_type) as r from public.workouts w left join public.group_workout_exercises e on e.workout_id = w.id left join public.group_workout_exercise_sets s on s.group_workout_exercise_id = e.id where w.program_id = '39dc737c-1f7e-43ff-a414-68dda082a1ed') as x) = 'faee2d50f38600beeb855a7710f182da'),
      ('Sawyer''s one logged session on the copy is on week 1 day 1', (select count(*) from public.athlete_sessions s join public.workouts w on w.id = s.workout_id where w.program_id = '84d908e7-7b92-4143-a1da-b810f120bce6') = 1 and exists (select 1 from public.athlete_sessions where id = '072e7dd6-82eb-4550-9ca0-d4f32b6cd806' and workout_id = 'b01e0b7c-efca-4648-b68c-1b2a452daecc')),
      ('is_ai_draft_program is exactly the expected function', coalesce((select md5(replace(pg_get_functiondef(p.oid), chr(13), '')) = '6b77132524936e6cadb7ef4758a8232c' from pg_proc p where p.oid = to_regprocedure('public.is_ai_draft_program(uuid)')), false)),
      ('is_ai_draft_workout is exactly the expected function', coalesce((select md5(replace(pg_get_functiondef(p.oid), chr(13), '')) = '05cd3cad64ff751a2dbbafbdc807ab34' from pg_proc p where p.oid = to_regprocedure('public.is_ai_draft_workout(uuid)')), false)),
      ('team_sheet_save is exactly the expected function (0419)', coalesce((select md5(replace(pg_get_functiondef(p.oid), chr(13), '')) = '3947181f746122f948651fb2e1180cf0' from pg_proc p where p.oid = to_regprocedure('public.team_sheet_save(uuid, text, jsonb, boolean, uuid, boolean)')), false)),
      ('training_partners_cross_org_enabled is there', to_regprocedure('public.training_partners_cross_org_enabled()') is not null),
      ('duplicate_program is exactly the expected function (0367)', coalesce((select md5(replace(pg_get_functiondef(p.oid), chr(13), '')) = 'ce06626f896861df13db41beaff635b0' from pg_proc p where p.oid = to_regprocedure('public.duplicate_program(uuid, uuid, uuid, uuid, text, date)')), false)),
      ('duplicate_program holds its set columns exactly twice (the insert and the select)', coalesce((select (length(d) - length(replace(d, 'target_rest_seconds, target_rest_max_seconds, target_pace', ''))) / length('target_rest_seconds, target_rest_max_seconds, target_pace') = 2 from (select pg_get_functiondef(to_regprocedure('public.duplicate_program(uuid, uuid, uuid, uuid, text, date)')) as d) x), false))
  ) as checks(check_name, ok) where not ok;
  if failed is not null then
    raise exception 'Release audit fixes Oct 26 (imports marked while written, Sawyer''s copy repaired, organization programs'' days closed to clients, team sheet, one search_path, copies keep set types), step 188 (0436) cannot run: this step looks already applied, or the database is not in the state it expects. Failed checks: %. NOTHING was changed (the whole bundle is all or nothing). If an earlier step was applied by hand, use the single-step files for the rest, and send Spot this message.', failed;
  end if;
end
$g188$;

-- ====================================================================================================
-- migration 0436_release_audit_fixes.sql
-- ====================================================================================================

-- Release audit fixes (Oct 26, after organization programs and Make a template went live). Five parts, each checked first; re-runnable.
--  1. programs.importing (default false): an import is written one day at a time from the browser, so while it is being written it is marked, switched off, and nothing copies it
--     (Assign, Duplicate and Make a template refuse it: "Still importing. Try again in a moment."). The app clears the mark and switches it on after the last day is written.
--     (No existing field could say this: a library or organization program is already switched off, an archived one can be restored half-written, and the label is shown.)
--  2. Sawyer Steele's copy of "Big Sauce but still little sauce" was made while that import was still being written (21:44:34; its last day was written at 21:44:57), so it has
--     29 of the 49 days (week 5 day 6 and weeks 6 to 8 are missing). Every source day the copy does not have is copied in, with its exercises, sets and notes, the way
--     duplicate_program copies (same columns, same order). Nothing the copy has is changed or deleted (its 29 days, Sawyer's logged session). Only when the copy still has exactly
--     its 29 days, by id; afterwards the copy must have as many days and exercises as the source, or nothing is kept.
--  3. A client never reads an organization program's days, exercises, sets, notes or progression rules: is_ai_draft_program and is_ai_draft_workout (used by the read rules of
--     workouts, workout_notes and exercise_progressions, and by is_workout_visible_to_athlete for exercises and sets) also answer true for an organization program. Coaches read as
--     before (each rule lets a coach of the group through first). A group's copy of an organization program is not one, so its members read it as before.
--  4. team_sheet_save never saves into an organization program's workout (one condition added to its "an active program of this group" check).
--  5. training_partners_cross_org_enabled gets a fixed, empty search_path (the security advisor's warning; it reads nothing).
--  6. duplicate_program copies each set's type (warm-up, working, AMRAP, back-off, drop). It did not, so every copy (Assign, Duplicate, a template, a group's copy) made every set a working
--     set. The set columns appear exactly twice in it (the insert's list and the select's); set_type is added to both.

do $col$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'programs' and column_name = 'importing') then
    alter table public.programs add column importing boolean not null default false;
  end if;
end
$col$;

do $repair$
declare
  v_src constant uuid := '39dc737c-1f7e-43ff-a414-68dda082a1ed';
  v_copy constant uuid := '84d908e7-7b92-4143-a1da-b810f120bce6';
  -- The copy's 29 days, as it was made.
  v_kept constant uuid[] := array[
    'b01e0b7c-efca-4648-b68c-1b2a452daecc', '98ddaaef-ae1e-4916-a549-e41e6c6e7e64', '4ebeee75-f643-467b-8fce-778127369de4', '6ae754cb-49be-476a-b39b-98d80ad7c561', '5e4c4c3f-d42d-4071-a065-b0cba433a377', '502722c9-958c-4ce4-a34f-2439d9f06b92',
    '21dde757-d49d-49ee-be95-cece14fcb339', '51607667-91d3-400a-97ba-bc46d28fa063', '440dd296-d06b-4f84-a62b-e367b28ccade', 'a67f4957-d98a-46a6-a6d6-bc2a381ab447', '3849fb9f-1372-49f0-8b41-b84b66c461ef', '6f926d43-4f42-416f-8c10-0fb6849a222b',
    '8a31b6bc-a000-45f4-b18b-6fc33fe7f8cb', '0c14ed22-2911-40d9-9a55-bf5e0bad2de3', 'd3f39a2d-90cc-40c5-b7d5-8ae089566ba9', 'd7ea11c9-5dc0-4633-ba6d-46ef4df7921d', '08d2ff98-df09-445f-8118-712335bd6f4c', '79c2dc10-483a-4d2d-a6f5-750b0dc83136',
    'd43b7570-d29c-48bc-9bbd-96bb8289dace', 'b2f2ccc0-8b57-4428-af4b-8da6b12de23f', 'e6421ad9-9c67-45d1-a149-9a2aa6a7a04b', '7737ec44-cf76-4a78-94f7-22e0c639fffa', '960628b5-a92f-450d-b6d8-efb68c1e28da', 'b577864d-eadc-42eb-9506-7dc1c7c15ff5',
    '86159c0f-bde8-45cf-ac25-51d967943b48', '4dc1fbeb-9dfb-47f8-941a-b9d1e24d4c33', '50e7172e-360f-4b65-8bdb-bd68f89e3b9b', 'cffa5008-258c-43c5-b41d-c69236dacba4', '94ecb5f7-c640-402e-b54f-09a3bbd0962f'
  ]::uuid[];
  v_group uuid;
  v_by uuid;
  w record;
  e record;
  v_new_w uuid;
  v_new_e uuid;
begin
  if not exists (select 1 from public.programs where id = v_src) or not exists (select 1 from public.programs where id = v_copy) then
    return; -- not the live database: nothing to repair
  end if;
  if (select count(*) from public.workouts where program_id = v_copy) = (select count(*) from public.workouts where program_id = v_src) then
    return; -- already whole (re-run)
  end if;
  if (select array_agg(id order by id) from public.workouts where program_id = v_copy) is distinct from (select array_agg(x order by x) from unnest(v_kept) x) then
    raise exception 'Sawyer''s copy does not have exactly the 29 days it was made with; NOTHING was changed.';
  end if;
  select group_id, created_by into v_group, v_by from public.programs where id = v_copy;

  for w in
    select s.* from public.workouts s
    where s.program_id = v_src
      and not exists (select 1 from public.workouts c where c.program_id = v_copy and c.week_number = s.week_number and c.day_index = s.day_index)
    order by s.week_number, s.day_index
  loop
    insert into public.workouts (program_id, group_id, title, week_number, day_index, notes)
    values (v_copy, v_group, w.title, w.week_number, w.day_index, w.notes)
    returning id into v_new_w;

    for e in select * from public.group_workout_exercises where workout_id = w.id order by exercise_order loop
      insert into public.group_workout_exercises (
        workout_id, group_id, exercise_name, exercise_order, movement_pattern_id, tracked_fields, notes, display_name,
        is_slot, slot_side, slot_tier
      )
      values (
        v_new_w, v_group, e.exercise_name, e.exercise_order,
        e.movement_pattern_id, e.tracked_fields, e.notes, e.display_name,
        e.is_slot, e.slot_side, e.slot_tier
      )
      returning id into v_new_e;

      insert into public.group_workout_exercise_sets (
        group_workout_exercise_id, set_order, target_reps, target_weight, target_rpe, target_rir,
        target_tempo, target_time_seconds, target_height, target_distance, rep_min, rep_max,
        target_rest_seconds, target_rest_max_seconds, target_pace, set_type
      )
      select
        v_new_e, set_order, target_reps, target_weight, target_rpe, target_rir,
        target_tempo, target_time_seconds, target_height, target_distance, rep_min, rep_max,
        target_rest_seconds, target_rest_max_seconds, target_pace, set_type
      from public.group_workout_exercise_sets
      where group_workout_exercise_id = e.id
      order by set_order;
    end loop;

    insert into public.workout_notes (workout_id, group_id, body, position, created_by)
    select v_new_w, v_group, body, position, v_by
    from public.workout_notes
    where workout_id = w.id
    order by position;
  end loop;

  if (select count(*) from public.workouts where program_id = v_copy) <> (select count(*) from public.workouts where program_id = v_src)
     or (select count(*) from public.group_workout_exercises g join public.workouts x on x.id = g.workout_id where x.program_id = v_copy)
        <> (select count(*) from public.group_workout_exercises g join public.workouts x on x.id = g.workout_id where x.program_id = v_src) then
    raise exception 'Sawyer''s copy does not match its program after the repair; NOTHING was changed.';
  end if;
  if exists (select 1 from public.athlete_sessions where id = '072e7dd6-82eb-4550-9ca0-d4f32b6cd806' and workout_id is distinct from 'b01e0b7c-efca-4648-b68c-1b2a452daecc') then
    raise exception 'Sawyer''s logged session no longer points at its workout; NOTHING was changed.';
  end if;
end
$repair$;

do $helpers$
declare
  v_def text;
  v_old constant text := '(p.ai_draft or p.archived_at is not null or';
  v_new constant text := '(p.ai_draft or p.org_program or p.archived_at is not null or';
  v_sig text;
begin
  foreach v_sig in array array['public.is_ai_draft_program(uuid)', 'public.is_ai_draft_workout(uuid)'] loop
    v_def := pg_get_functiondef(v_sig::regprocedure);
    if position(v_new in v_def) > 0 then
      continue; -- already changed (re-run)
    end if;
    if (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 1 then
      raise exception '% does not hold its draft check exactly once; NOTHING was changed.', v_sig;
    end if;
    execute replace(v_def, v_old, v_new);
  end loop;
end
$helpers$;

do $sheet$
declare
  v_def text := pg_get_functiondef('public.team_sheet_save(uuid, text, jsonb, boolean, uuid, boolean)'::regprocedure);
  v_old constant text := 'and pr.is_active and pr.athlete_id is null';
  v_new constant text := 'and pr.is_active and pr.athlete_id is null and not pr.org_program';
begin
  if position(v_new in v_def) > 0 then
    return; -- already changed (re-run)
  end if;
  if (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 1 then
    raise exception 'team_sheet_save does not hold its program check exactly once; NOTHING was changed.';
  end if;
  execute replace(v_def, v_old, v_new);
end
$sheet$;

alter function public.training_partners_cross_org_enabled() set search_path = '';

do $dup$
declare
  v_def text := pg_get_functiondef('public.duplicate_program(uuid, uuid, uuid, uuid, text, date)'::regprocedure);
  v_old constant text := 'target_rest_seconds, target_rest_max_seconds, target_pace';
  v_new constant text := 'target_rest_seconds, target_rest_max_seconds, target_pace, set_type';
begin
  if position(v_new in v_def) > 0 then
    return; -- already changed (re-run)
  end if;
  if (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 2 then
    raise exception 'duplicate_program does not hold its set columns exactly twice (the insert and the select); NOTHING was changed.';
  end if;
  execute replace(v_def, v_old, v_new);
end
$dup$;

commit;

-- Read-only result (after the commit): every row must say in_place = true.
select step, what, in_place from (
  select 'step 188 (0436)' as step, '0436 Release audit fixes: an import is marked while it is written' as what, not ((not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'programs' and column_name = 'importing'))) as in_place
) as result order by step;
