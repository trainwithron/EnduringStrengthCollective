-- STEP 185: 0433 Audit hardening: undoing attended takes the same check as a no-show (the booking's own coach or an organization owner/admin); signed-out visitors get no rights on two tables
--
-- !! This changes ONE condition in undo_booking_attended (who may undo an attended session, which puts the session back on the client's balance): from any coach of the group to the booking's own coach or an organization owner/admin, the same check resolve_no_show and set_booking_no_show already use. The paste checks that the live function holds the old condition exactly once, and stops if not. It also removes signed-out visitors' table rights on client_macro_target_history and coach_booking_policies (every policy on them is for signed-in people already).
--
-- Run apply-precheck first (every row ok = true). Then paste THIS file and run it once.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."
-- AFTERWARDS: Nothing changes for the coach who marked a session: they can undo it as before. Another coach of the same group can no longer undo it (an owner or admin can). No screen changes.
-- ON ERROR: it is all or nothing, so nothing was applied. Run   rollback;   once, copy the red error text, and send it back. Do not run the file again.
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

do $guard$
begin
  if not ((position('is_org_admin_of_group' in coalesce(pg_get_functiondef(to_regprocedure('public.undo_booking_attended(uuid)')), '')) = 0)) then
    raise exception 'Step 185 (0433) looks already applied, or the database is not in the state it expects. Nothing was changed. Run the precheck file and send Spot the result.';
  end if;
end
$guard$;

-- ====================================================================================================
-- migration 0433_undo_attended_own_coach_and_anon_revokes.sql
-- ====================================================================================================

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

commit;
