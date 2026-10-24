-- UNDO for step 185 (0433). Only if step 185 misbehaves. The old condition is put back and signed-out visitors get select on the two tables again, as before.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."   Then tell Spot, and do not run the step again until Spot says why it failed.
begin;
do $undo$
declare
  v_def text := pg_get_functiondef('public.undo_booking_attended(uuid)'::regprocedure);
  v_new text := 'not ((v_b.coach_id = auth.uid() and public.is_group_coach(v_b.group_id)) or public.is_org_admin_of_group(v_b.group_id))';
begin
  if position(v_new in v_def) > 0 then
    execute replace(v_def, v_new, 'not public.is_group_coach(v_b.group_id)');
  end if;
end $undo$;
grant select on public.client_macro_target_history to anon;
grant select on public.coach_booking_policies to anon;
commit;
