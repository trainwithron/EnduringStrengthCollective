-- STEP 187 (PRECHECK, run first, changes nothing): 0435 Organization programs: a mark for the organization's own programs (never followed by anyone, only copied to a client or a group), its backfill, one condition in the programs read rule and one in assign_program_to_client
--
-- !! This adds programs.org_program (default false) and, ONCE, marks the programs with no client, not archived, in a team or social group that has no clients (9 live programs on Oct 26, the Collective's 5 among them; the 3 in groups that have clients stay those groups' programs). It then adds ONE condition to programs_select_members (a person who does not coach the group never reads an organization program; the paste checks the live rule is exactly the expected text, and stops if not) and ONE to assign_program_to_client (an organization program is always copied to a client, never handed over; the paste checks the live function is exactly the expected one, and stops if not).
--
-- Paste into the Supabase SQL editor and run. Every row must say ok = true.
-- If any row says false: do NOT run the apply file. Copy the result table and send it back.
select check_name, ok
from (
  values
    ('0435 is not already applied (programs has no org_program yet)',
      not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'programs' and column_name = 'org_program')),
    ('programs_select_members is exactly the expected text',
      coalesce((select qual from pg_policies where schemaname = 'public' and tablename = 'programs' and policyname = 'programs_select_members') = '((group_id IN ( SELECT my_group_ids() AS my_group_ids)) AND ((athlete_id IS NULL) OR (athlete_id = ( SELECT auth.uid() AS uid)) OR (group_id IN ( SELECT my_coached_group_ids() AS my_coached_group_ids))) AND ((group_id IN ( SELECT my_coached_group_ids() AS my_coached_group_ids)) OR ((NOT ai_draft) AND (archived_at IS NULL) AND ((athlete_id IS NOT NULL) OR (NOT is_one_on_one_group(group_id))))))', false)),
    ('assign_program_to_client is exactly the expected function (0424)',
      coalesce((select md5(replace(pg_get_functiondef(p.oid), chr(13), '')) = '8f6b77c8a837bd090fbccc085b1d252a' from pg_proc p where p.oid = to_regprocedure('public.assign_program_to_client(uuid, uuid, uuid, text, date)')), false)),
    ('assign_program_to_client holds its hand-over check exactly once',
      coalesce((select (length(d) - length(replace(d, 'and not src.ai_draft', ''))) / length('and not src.ai_draft') = 1 from (select pg_get_functiondef(to_regprocedure('public.assign_program_to_client(uuid, uuid, uuid, text, date)')) as d) x), false))
) as checks(check_name, ok);
