-- STEP 146 (PRECHECK, run first, changes nothing): 0394 Release J: a new season for a team (the old group is retired and kept whole; the new one has the same positions, coaches and the athletes chosen)
--
-- Paste into the Supabase SQL editor and run. Every row must say ok = true.
-- If any row says false: do NOT run the apply file. Copy the result table and send it back.
select check_name, ok
from (
  values
    ('0394 is not already applied (the retired-at column is not there yet)',
      not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'groups' and column_name = 'archived_at')),
    ('the tables it builds on exist',
      to_regclass('public.groups') is not null and to_regclass('public.group_memberships') is not null and to_regclass('public.group_positions') is not null and to_regclass('public.audit_log') is not null),
    ('the helper functions it uses exist',
      to_regprocedure('public.is_group_coach(uuid)') is not null and to_regprocedure('public.audit_record(text, text, text, jsonb)') is not null)
) as checks(check_name, ok);
