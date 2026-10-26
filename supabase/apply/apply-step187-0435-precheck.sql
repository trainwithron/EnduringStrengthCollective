-- STEP 187 (PRECHECK, run first, changes nothing): 0435 Organization programs: a mark for the organization's own programs (never followed by anyone, only copied to a client or a group), its backfill, one condition in the programs read rule and one in assign_program_to_client
--
-- !! This adds programs.org_program (default false) and, ONCE, marks exactly the 5 programs in the Collective (Enduring Strength Co.'s anchor group: Glentuckey fr this time, Maria “The Ese” Guiterrez, At Home mobility, Brendan's program, New program), by id. Every other program stays its group's, the Trojans' and The Home Team's included (a team with no athletes yet is waiting for members). It then adds ONE condition to programs_select_members (a person who does not coach the group never reads an organization program; the paste checks the live rule is exactly the expected text, and stops if not) and ONE to assign_program_to_client (an organization program is always copied to a client, never handed over; the paste checks the live function is exactly the expected one, and stops if not).
--
-- Paste into the Supabase SQL editor and run. Every row must say ok = true.
-- If any row says false: do NOT run the apply file. Copy the result table and send it back.
select check_name, ok
from (
  values
    ('0435 is not already applied (programs has no org_program yet)',
      not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'programs' and column_name = 'org_program')),
    ('the Collective''s 5 programs are there, each with no client and not archived',
      (select count(*) from public.programs where id in ('a6102694-0297-4142-b73f-e391649418be', '2738d78a-2b5f-4286-a249-adbedcf15459', '2143be95-1aa8-42a1-98f2-42c9b2b131bc', '4d029d91-cbb1-4a78-9e96-4f31c9263999', 'a117a12b-7ca3-4765-88cc-aae150585424') and group_id = '44444444-4444-4444-4444-444444444444' and athlete_id is null and archived_at is null) = 5),
    ('programs_select_members is exactly the expected text',
      coalesce((select qual from pg_policies where schemaname = 'public' and tablename = 'programs' and policyname = 'programs_select_members') = '((group_id IN ( SELECT my_group_ids() AS my_group_ids)) AND ((athlete_id IS NULL) OR (athlete_id = ( SELECT auth.uid() AS uid)) OR (group_id IN ( SELECT my_coached_group_ids() AS my_coached_group_ids))) AND ((group_id IN ( SELECT my_coached_group_ids() AS my_coached_group_ids)) OR ((NOT ai_draft) AND (archived_at IS NULL) AND ((athlete_id IS NOT NULL) OR (NOT is_one_on_one_group(group_id))))))', false)),
    ('assign_program_to_client is exactly the expected function (0424)',
      coalesce((select md5(replace(pg_get_functiondef(p.oid), chr(13), '')) = '8f6b77c8a837bd090fbccc085b1d252a' from pg_proc p where p.oid = to_regprocedure('public.assign_program_to_client(uuid, uuid, uuid, text, date)')), false)),
    ('assign_program_to_client holds its hand-over check exactly once',
      coalesce((select (length(d) - length(replace(d, 'and not src.ai_draft', ''))) / length('and not src.ai_draft') = 1 from (select pg_get_functiondef(to_regprocedure('public.assign_program_to_client(uuid, uuid, uuid, text, date)')) as d) x), false))
) as checks(check_name, ok);
