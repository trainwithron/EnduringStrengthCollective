-- STEP 185 (PRECHECK, run first, changes nothing): 0433 Audit hardening: undoing attended takes the same check as a no-show (the booking's own coach or an organization owner/admin); signed-out visitors get no rights on two tables
--
-- !! This changes ONE condition in undo_booking_attended (who may undo an attended session, which puts the session back on the client's balance): from any coach of the group to the booking's own coach or an organization owner/admin, the same check resolve_no_show and set_booking_no_show already use. The paste checks that the live function holds the old condition exactly once, and stops if not. It also removes signed-out visitors' table rights on client_macro_target_history and coach_booking_policies (every policy on them is for signed-in people already).
--
-- Paste into the Supabase SQL editor and run. Every row must say ok = true.
-- If any row says false: do NOT run the apply file. Copy the result table and send it back.
select check_name, ok
from (
  values
    ('0433 is not already applied (undo_booking_attended still has the old check)',
      position('is_org_admin_of_group' in coalesce(pg_get_functiondef(to_regprocedure('public.undo_booking_attended(uuid)')), '')) = 0),
    ('undo_booking_attended holds its coach check exactly once',
      coalesce((select (length(d) - length(replace(d, 'not public.is_group_coach(v_b.group_id)', ''))) / length('not public.is_group_coach(v_b.group_id)') = 1 from (select pg_get_functiondef(to_regprocedure('public.undo_booking_attended(uuid)')) as d) x), false)),
    ('the tables and the admin check exist',
      to_regclass('public.client_macro_target_history') is not null and to_regclass('public.coach_booking_policies') is not null and to_regprocedure('public.is_org_admin_of_group(uuid)') is not null)
) as checks(check_name, ok);
