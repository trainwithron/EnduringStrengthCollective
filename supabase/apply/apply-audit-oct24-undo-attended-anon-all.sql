-- AUDIT HARDENING OCT 24 (UNDOING ATTENDED: THE BOOKING'S OWN COACH OR AN OWNER/ADMIN; TWO ANON REVOKES): ONE paste. Steps 185 in order, all or nothing.
--
-- Paste this whole file into the Supabase SQL editor and run it once. It replaces the separate precheck and apply files for these steps (they stay as the fallback).
-- Every check from each step's precheck is built in as a guard in front of that step. If any check is false, the run stops with a message that names the step and the
-- failed check, and NOTHING is kept, so a second run after a refusal is safe.
-- WHAT YOU SHOULD SEE: first "Success" for the transaction, then a result table with one row per step and in_place = true on every row.
-- ON ERROR: run   rollback;   once, copy the red text, send it to Spot. Do not run it again.
-- AFTER STEP 185: Nothing changes for the coach who marked a session: they can undo it as before. Another coach of the same group can no longer undo it (an owner or admin can). No screen changes.
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

-- ===== Audit hardening Oct 24 (undoing attended: the booking's own coach or an owner/admin; two anon revokes), step 185: 0433 Audit hardening: undoing attended takes the same check as a no-show (the booking's own coach or an organization owner/admin); signed-out visitors get no rights on two tables
do $g185$
declare
  failed text;
begin
  select string_agg(check_name, '; ') into failed from (
    values
      ('0433 is not already applied (undo_booking_attended still has the old check)', position('is_org_admin_of_group' in coalesce(pg_get_functiondef(to_regprocedure('public.undo_booking_attended(uuid)')), '')) = 0),
      ('undo_booking_attended holds its coach check exactly once', coalesce((select (length(d) - length(replace(d, 'not public.is_group_coach(v_b.group_id)', ''))) / length('not public.is_group_coach(v_b.group_id)') = 1 from (select pg_get_functiondef(to_regprocedure('public.undo_booking_attended(uuid)')) as d) x), false)),
      ('the tables and the admin check exist', to_regclass('public.client_macro_target_history') is not null and to_regclass('public.coach_booking_policies') is not null and to_regprocedure('public.is_org_admin_of_group(uuid)') is not null)
  ) as checks(check_name, ok) where not ok;
  if failed is not null then
    raise exception 'Audit hardening Oct 24 (undoing attended: the booking''s own coach or an owner/admin; two anon revokes), step 185 (0433) cannot run: this step looks already applied, or the database is not in the state it expects. Failed checks: %. NOTHING was changed (the whole bundle is all or nothing). If an earlier step was applied by hand, use the single-step files for the rest, and send Spot this message.', failed;
  end if;
end
$g185$;

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

-- Read-only result (after the commit): every row must say in_place = true.
select step, what, in_place from (
  select 'step 185 (0433)' as step, '0433 Audit hardening: undoing attended takes the same check as a no-show' as what, not ((position('is_org_admin_of_group' in coalesce(pg_get_functiondef(to_regprocedure('public.undo_booking_attended(uuid)')), '')) = 0)) as in_place
) as result order by step;
