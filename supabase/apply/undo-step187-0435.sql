-- UNDO for step 187 (0435). Only if step 187 misbehaves, and only while the app update that goes with it is NOT live (it reads org_program). The read rule and the assign function get their old text back and the column goes (the mark on the 9 programs is lost; they are ordinary programs of their group again, as before).
-- WHAT YOU SHOULD SEE: "Success. No rows returned."   Then tell Spot, and do not run the step again until Spot says why it failed.
begin;
alter policy programs_select_members on public.programs using (
  (group_id in (select public.my_group_ids()))
  and ((athlete_id is null) or (athlete_id = (select auth.uid())) or (group_id in (select public.my_coached_group_ids())))
  and ((group_id in (select public.my_coached_group_ids())) or ((not ai_draft) and (archived_at is null) and ((athlete_id is not null) or (not public.is_one_on_one_group(group_id)))))
);
do $undo$
declare
  v_def text := pg_get_functiondef('public.assign_program_to_client(uuid, uuid, uuid, text, date)'::regprocedure);
begin
  if position('and not src.ai_draft and not src.org_program' in v_def) > 0 then
    execute replace(v_def, 'and not src.ai_draft and not src.org_program', 'and not src.ai_draft');
  end if;
end $undo$;
alter table public.programs drop column if exists org_program;
commit;
