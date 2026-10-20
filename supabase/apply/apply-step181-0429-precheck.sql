-- STEP 181 (PRECHECK, run first, changes nothing): 0429 Set my targets: a client whose coach has set no nutrition target may set their own (one column, one trigger, one function, three client policies; the target-changed notice skips a client's own change)
--
-- !! This adds a set_by column to client_macro_target_history ('coach' for every existing row and every row a coach writes, 'self' for a client's own), a trigger that makes any row written for someone else a coach row, has_coach_macro_target(athlete, group) (answers only about the caller), and three policies that let a client insert, change and remove ONLY their own 'self' rows: in a group they belong to, only while minor_may_write says they may write, only while their coach has set no target, and dated yesterday to tomorrow. The coach policy is not touched. It REPLACES notify_on_target_change() with the live text plus one early return for a 'self' row; the paste checks that the live function is exactly the text this matches, and stops if not.
--
-- Paste into the Supabase SQL editor and run. Every row must say ok = true.
-- If any row says false: do NOT run the apply file. Copy the result table and send it back.
select check_name, ok
from (
  values
    ('0429 is not already applied (the helper has_coach_macro_target is not there yet; after an undo the set_by column stays and this step applies again)',
      not (to_regprocedure('public.has_coach_macro_target(uuid, uuid)') is not null)),
    ('notify_on_target_change is exactly the text this replaces',
      coalesce((select md5(replace(pg_get_functiondef(p.oid), chr(13), '')) = '4b242454c85aff22b234860e4a6f026f' from pg_proc p where p.oid = to_regprocedure('public.notify_on_target_change()')), false)),
    ('the functions and tables it uses exist',
      to_regprocedure('public.minor_may_write(uuid)') is not null and to_regclass('public.client_macro_targets') is not null and to_regclass('public.group_memberships') is not null),
    ('no client policy with these names exists yet',
      not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'client_macro_target_history' and policyname like 'client_macro_target_history_self_%'))
) as checks(check_name, ok);
