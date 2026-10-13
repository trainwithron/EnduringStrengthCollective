-- STEP 114 (PRECHECK, run first, changes nothing): 0364 A group session (class) belongs to one organization: members see, join and are counted in only the classes of an organization in which they are that coach's client (no class exists yet)
--
-- Paste into the Supabase SQL editor and run. Every row must say ok = true.
-- If any row says false: do NOT run the apply file. Copy the result table and send it back.
select check_name, ok
from (
  values
    ('0364 is not already applied (the class table has no organization column yet)',
      not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'group_sessions' and column_name = 'organization_id')),
    ('the class table is empty (so no class is left without an organization)',
      case when to_regclass('public.group_sessions') is null then false else (xpath('/row/c/text()', query_to_xml('select count(*) as c from public.group_sessions where kind = ''class''', false, true, '')))[1]::text = '0' end)
) as checks(check_name, ok);
