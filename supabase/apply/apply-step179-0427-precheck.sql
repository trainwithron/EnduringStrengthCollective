-- STEP 179 (PRECHECK, run first, changes nothing): 0427 SPEED B: the read policies on the ten busiest tables ask 'member / coach / owner or admin of this group' from three sets once per query (three new functions; 15 read policies rewritten in place)
--
-- !! This adds three functions (my_group_ids, my_coached_group_ids, my_admin_group_ids) and rewrites 15 read policies in place, replacing is_group_member(x), is_group_coach(x) and is_org_admin_of_group(x) word for word with x in the matching set. Nothing else in their text changes; is_client_private_from_org and every other check stay. The paste checks that the 15 policies and the three per-row functions are exactly the texts this matches, and stops if not.
--
-- Paste into the Supabase SQL editor and run. Every row must say ok = true.
-- If any row says false: do NOT run the apply file. Copy the result table and send it back.
select check_name, ok
from (
  values
    ('0427 is not already applied (the member set is not there yet)',
      not (to_regprocedure('public.my_group_ids()') is not null)),
    ('the 15 read policies are exactly the texts this rewrites',
      (select md5(string_agg(tablename || '|' || policyname || '|' || cmd || '|' || coalesce(qual, '') || '|' || coalesce(with_check, ''), chr(10) order by tablename, policyname)) from pg_policies where schemaname = 'public' and tablename in ('programs','workouts','group_workout_exercises','group_workout_exercise_sets','athlete_sessions','session_exercises','set_logs','group_memberships','groups','workout_logs') and cmd in ('SELECT', 'ALL') and policyname <> 'org_wall_header' and (coalesce(qual, '') ~ '\m(is_group_member|is_group_coach|is_org_admin_of_group)\(' or coalesce(with_check, '') ~ '\m(is_group_member|is_group_coach|is_org_admin_of_group)\(')) = '66584b2355b8f2cc0413bc374c52a413'),
    ('is_group_member is exactly the text the member set matches',
      coalesce((select md5(replace(pg_get_functiondef(p.oid), chr(13), '')) = '4883c4ef8376c3d48bcfd5e2f20d3814' from pg_proc p where p.oid = to_regprocedure('public.is_group_member(uuid)')), false)),
    ('is_group_coach is exactly the text the coach set matches',
      coalesce((select md5(replace(pg_get_functiondef(p.oid), chr(13), '')) = 'efa2e330be5434af47ce88d3be81d5d4' from pg_proc p where p.oid = to_regprocedure('public.is_group_coach(uuid)')), false)),
    ('is_org_admin_of_group is exactly the text the owner/admin set matches',
      coalesce((select md5(replace(pg_get_functiondef(p.oid), chr(13), '')) = '142a65df511b5db2c3c328ffeec3d2dc' from pg_proc p where p.oid = to_regprocedure('public.is_org_admin_of_group(uuid)')), false))
) as checks(check_name, ok);
