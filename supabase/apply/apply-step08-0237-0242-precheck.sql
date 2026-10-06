-- STEP 08 (PRECHECK, run first, changes nothing): 0237 join a group with an invite code (checked in the database), 0242 cancelling invite links
--
-- Paste into the Supabase SQL editor and run. Every row must say ok = true.
-- If any row says false: do NOT run the apply file. Copy the result table and send it back.
select check_name, ok
from (
  values
    ('group_invites and client_invites exist',
      to_regclass('public.group_invites') is not null and to_regclass('public.client_invites') is not null),
    ('groups.group_kind exists and get_invite_info / has_valid_group_invite exist',
      exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'groups' and column_name = 'group_kind') and exists (select 1 from pg_proc where proname = 'get_invite_info' and pronamespace = 'public'::regnamespace) and exists (select 1 from pg_proc where proname = 'has_valid_group_invite' and pronamespace = 'public'::regnamespace)),
    ('0237 is not already applied',
      not exists (select 1 from pg_proc where proname = 'join_group_with_invite' and pronamespace = 'public'::regnamespace)),
    ('0242 is not already applied',
      not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'group_invites' and column_name = 'revoked_at'))
) as checks(check_name, ok);
