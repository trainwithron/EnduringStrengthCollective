-- Audit hardening (Oct 24).
--  * undo_booking_attended: undoing "attended" puts a session back on the client's balance, so it takes the same check as marking a no-show (resolve_no_show, set_booking_no_show):
--    the booking's own coach (still a coach of the group) or an organization owner/admin. Before, ANY coach of the group could undo another coach's attended session. The function's live
--    text is changed in place (one condition), after checking it holds that condition exactly once.
--  * Signed-out visitors get no table rights on client_macro_target_history and coach_booking_policies (every policy on them is for signed-in people; 0431 did the same for
--    coach_read_passages). Nothing the app does as a signed-out visitor reads them.
-- Re-runnable.

do $patch$
declare
  v_def text;
  v_old text := 'not public.is_group_coach(v_b.group_id)';
  v_new text := 'not ((v_b.coach_id = auth.uid() and public.is_group_coach(v_b.group_id)) or public.is_org_admin_of_group(v_b.group_id))';
begin
  v_def := pg_get_functiondef('public.undo_booking_attended(uuid)'::regprocedure);
  if position(v_new in v_def) > 0 then
    return; -- already changed (re-run)
  end if;
  if (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 1 then
    raise exception 'undo_booking_attended does not hold its coach check exactly once; NOTHING was changed.';
  end if;
  execute replace(v_def, v_old, v_new);
end
$patch$;

revoke all on public.client_macro_target_history from anon;
revoke all on public.coach_booking_policies from anon;
