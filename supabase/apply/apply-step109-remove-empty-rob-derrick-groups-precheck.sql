-- STEP 109 (PRECHECK, run first, changes nothing): remove the two empty one-on-one groups named Rob Derrick left behind by the failed add-client attempts (both have no members, programs, sessions, posts or invites); undoable
--
-- !! A one-time data change that deletes exactly two EMPTY groups by id (e2425435-950a-409d-8d4e-e24d92f21652 and 568e84b6-b85c-476c-b160-7b6b64e21caa). It stops with nothing changed if either one has any member, program, session, post or invite.
--
-- Paste into the Supabase SQL editor and run. Every row must say ok = true.
-- If any row says false: do NOT run the apply file. Copy the result table and send it back.
select check_name, ok
from (
  values
    ('both stray groups exist',
      (select count(*) from public.groups where id in ('e2425435-950a-409d-8d4e-e24d92f21652', '568e84b6-b85c-476c-b160-7b6b64e21caa') and name = 'Rob Derrick' and group_kind = 'one_on_one') = 2),
    ('neither has a member, program, session, post or invite',
      not exists (select 1 from public.group_memberships where group_id in ('e2425435-950a-409d-8d4e-e24d92f21652', '568e84b6-b85c-476c-b160-7b6b64e21caa')) and not exists (select 1 from public.programs where group_id in ('e2425435-950a-409d-8d4e-e24d92f21652', '568e84b6-b85c-476c-b160-7b6b64e21caa')) and not exists (select 1 from public.athlete_sessions where group_id in ('e2425435-950a-409d-8d4e-e24d92f21652', '568e84b6-b85c-476c-b160-7b6b64e21caa')) and not exists (select 1 from public.posts where group_id in ('e2425435-950a-409d-8d4e-e24d92f21652', '568e84b6-b85c-476c-b160-7b6b64e21caa')) and not exists (select 1 from public.group_invites where group_id in ('e2425435-950a-409d-8d4e-e24d92f21652', '568e84b6-b85c-476c-b160-7b6b64e21caa'))),
    ('step 109 is not already applied (the cleanup log is not there yet)',
      to_regclass('public.orphan_group_cleanup_log') is null)
) as checks(check_name, ok);
