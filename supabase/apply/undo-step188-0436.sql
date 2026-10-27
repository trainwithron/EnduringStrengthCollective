-- UNDO for step 188 (0436). Only if step 188 misbehaves, and only while the app update that goes with it is NOT live (it writes programs.importing). It removes only the days step 188 added to Sawyer's copy (and stops, removing nothing, if Sawyer has logged anything on one of them), puts the four functions' old text back (duplicate_program then copies every set as a working set again), takes the search_path off and drops the column.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."   Then tell Spot, and do not run the step again until Spot says why it failed.
begin;
do $undo$
declare
  v_added uuid[] := (select coalesce(array_agg(w.id), '{}') from public.workouts w where w.program_id = '84d908e7-7b92-4143-a1da-b810f120bce6' and (w.week_number, w.day_index) in ((5,6),(6,1),(6,2),(6,3),(6,4),(6,5),(6,6),(7,1),(7,2),(7,3),(7,4),(7,5),(7,6),(8,1),(8,2),(8,3),(8,4),(8,5),(8,6),(8,7)) and not (w.id = any (array['b01e0b7c-efca-4648-b68c-1b2a452daecc', '98ddaaef-ae1e-4916-a549-e41e6c6e7e64', '4ebeee75-f643-467b-8fce-778127369de4', '6ae754cb-49be-476a-b39b-98d80ad7c561', '5e4c4c3f-d42d-4071-a065-b0cba433a377', '502722c9-958c-4ce4-a34f-2439d9f06b92', '21dde757-d49d-49ee-be95-cece14fcb339', '51607667-91d3-400a-97ba-bc46d28fa063', '440dd296-d06b-4f84-a62b-e367b28ccade', 'a67f4957-d98a-46a6-a6d6-bc2a381ab447', '3849fb9f-1372-49f0-8b41-b84b66c461ef', '6f926d43-4f42-416f-8c10-0fb6849a222b', '8a31b6bc-a000-45f4-b18b-6fc33fe7f8cb', '0c14ed22-2911-40d9-9a55-bf5e0bad2de3', 'd3f39a2d-90cc-40c5-b7d5-8ae089566ba9', 'd7ea11c9-5dc0-4633-ba6d-46ef4df7921d', '08d2ff98-df09-445f-8118-712335bd6f4c', '79c2dc10-483a-4d2d-a6f5-750b0dc83136', 'd43b7570-d29c-48bc-9bbd-96bb8289dace', 'b2f2ccc0-8b57-4428-af4b-8da6b12de23f', 'e6421ad9-9c67-45d1-a149-9a2aa6a7a04b', '7737ec44-cf76-4a78-94f7-22e0c639fffa', '960628b5-a92f-450d-b6d8-efb68c1e28da', 'b577864d-eadc-42eb-9506-7dc1c7c15ff5', '86159c0f-bde8-45cf-ac25-51d967943b48', '4dc1fbeb-9dfb-47f8-941a-b9d1e24d4c33', '50e7172e-360f-4b65-8bdb-bd68f89e3b9b', 'cffa5008-258c-43c5-b41d-c69236dacba4', '94ecb5f7-c640-402e-b54f-09a3bbd0962f']::uuid[])));
begin
  if exists (select 1 from public.athlete_sessions where workout_id = any (v_added)) or exists (select 1 from public.workout_logs where workout_id = any (v_added)) or exists (select 1 from public.workout_assignments where workout_id = any (v_added))
     or exists (select 1 from public.session_exercises se join public.group_workout_exercises g on g.id = se.group_workout_exercise_id where g.workout_id = any (v_added))
     or exists (select 1 from public.athlete_exercise_overrides o join public.group_workout_exercises g on g.id = o.group_workout_exercise_id where g.workout_id = any (v_added)) then
    raise exception 'Sawyer has logged or been given something on a day step 188 added; NOTHING was undone. Send Spot this message.';
  end if;
  delete from public.workouts where id = any (v_added);
end $undo$;
do $undo2$
declare
  v_sig text;
  v_def text;
begin
  foreach v_sig in array array['public.is_ai_draft_program(uuid)', 'public.is_ai_draft_workout(uuid)'] loop
    v_def := pg_get_functiondef(v_sig::regprocedure);
    if position('(p.ai_draft or p.org_program or p.archived_at is not null or' in v_def) > 0 then
      execute replace(v_def, '(p.ai_draft or p.org_program or p.archived_at is not null or', '(p.ai_draft or p.archived_at is not null or');
    end if;
  end loop;
  v_def := pg_get_functiondef('public.team_sheet_save(uuid, text, jsonb, boolean, uuid, boolean)'::regprocedure);
  if position('and pr.is_active and pr.athlete_id is null and not pr.org_program' in v_def) > 0 then
    execute replace(v_def, 'and pr.is_active and pr.athlete_id is null and not pr.org_program', 'and pr.is_active and pr.athlete_id is null');
  end if;
end $undo2$;
alter function public.training_partners_cross_org_enabled() reset search_path;
do $undo3$
declare
  v_def text := pg_get_functiondef('public.duplicate_program(uuid, uuid, uuid, uuid, text, date)'::regprocedure);
begin
  if position('target_rest_seconds, target_rest_max_seconds, target_pace, set_type' in v_def) > 0 then
    execute replace(v_def, 'target_rest_seconds, target_rest_max_seconds, target_pace, set_type', 'target_rest_seconds, target_rest_max_seconds, target_pace');
  end if;
end $undo3$;
alter table public.programs drop column if exists importing;
commit;
