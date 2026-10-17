-- STEP 145 (PRECHECK, run first, changes nothing): 0393 Release I: a coach can invite someone who already has an account to be their one-on-one client (they accept or decline), and the notification types the invite code writes are accepted
--
-- Paste into the Supabase SQL editor and run. Every row must say ok = true.
-- If any row says false: do NOT run the apply file. Copy the result table and send it back.
select check_name, ok
from (
  values
    ('0393 is not already applied (the invitations table is not there yet)',
      to_regclass('public.space_invites') is null),
    ('the tables it builds on exist',
      to_regclass('public.groups') is not null and to_regclass('public.group_memberships') is not null and to_regclass('public.notifications') is not null),
    ('the notification type rule exists to be widened',
      exists (select 1 from pg_constraint c where c.conname = 'notifications_type_check' and c.conrelid = 'public.notifications'::regclass)),
    ('the helper functions it uses exist',
      to_regprocedure('public.is_group_coach(uuid)') is not null and to_regprocedure('public.is_one_on_one_group(uuid)') is not null)
) as checks(check_name, ok);
