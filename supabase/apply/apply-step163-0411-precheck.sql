-- STEP 163 (PRECHECK, run first, changes nothing): 0411 Release CM1: report a post or comment, and block a member (two small tables, two functions, one new kind of notice)
--
-- !! This REBUILDS the list of allowed notice kinds (adds one: content_reported). It refuses to run if the live list cannot be read or would lose a kind, and changes nothing in that case.
--
-- Paste into the Supabase SQL editor and run. Every row must say ok = true.
-- If any row says false: do NOT run the apply file. Copy the result table and send it back.
select check_name, ok
from (
  values
    ('0411 is not already applied (the reports table is not there yet)',
      to_regclass('public.content_reports') is null),
    ('the tables and helpers it uses exist',
      to_regclass('public.posts') is not null and to_regclass('public.comments') is not null and to_regclass('public.groups') is not null and to_regclass('public.group_memberships') is not null and to_regprocedure('public.is_group_coach(uuid)') is not null),
    ('the notification type rule exists to be widened',
      exists (select 1 from pg_constraint c where c.conname = 'notifications_type_check' and c.conrelid = 'public.notifications'::regclass))
) as checks(check_name, ok);
