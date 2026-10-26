-- ORGANIZATION PROGRAMS (THE ORGANIZATION'S OWN PROGRAMS: NEVER FOLLOWED, COPIED TO A CLIENT OR A GROUP): ONE paste. Steps 187 in order, all or nothing.
--
-- Paste this whole file into the Supabase SQL editor and run it once. It replaces the separate precheck and apply files for these steps (they stay as the fallback).
-- Every check from each step's precheck is built in as a guard in front of that step. If any check is false, the run stops with a message that names the step and the
-- failed check, and NOTHING is kept, so a second run after a refusal is safe.
-- WHAT YOU SHOULD SEE: first "Success" for the transaction, then a result table with one row per step and in_place = true on every row.
-- ON ERROR: run   rollback;   once, copy the red text, send it to Spot. Do not run it again.
-- AFTER STEP 187: Nothing on screen changes until the app update that goes with it is deployed (deploy it right after). Then the organization's programs say only the organization at the top, Assign lists the organization's clients and its groups, and a client added to the Collective never gets the organization's programs.
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

-- ===== Organization programs (the organization's own programs: never followed, copied to a client or a group), step 187: 0435 Organization programs: a mark for the organization's own programs (never followed by anyone, only copied to a client or a group), its backfill, one condition in the programs read rule and one in assign_program_to_client
do $g187$
declare
  failed text;
begin
  select string_agg(check_name, '; ') into failed from (
    values
      ('0435 is not already applied (programs has no org_program yet)', not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'programs' and column_name = 'org_program')),
      ('the Collective''s 5 programs are there, each with no client and not archived', (select count(*) from public.programs where id in ('a6102694-0297-4142-b73f-e391649418be', '2738d78a-2b5f-4286-a249-adbedcf15459', '2143be95-1aa8-42a1-98f2-42c9b2b131bc', '4d029d91-cbb1-4a78-9e96-4f31c9263999', 'a117a12b-7ca3-4765-88cc-aae150585424') and group_id = '44444444-4444-4444-4444-444444444444' and athlete_id is null and archived_at is null) = 5),
      ('programs_select_members is exactly the expected text', coalesce((select qual from pg_policies where schemaname = 'public' and tablename = 'programs' and policyname = 'programs_select_members') = '((group_id IN ( SELECT my_group_ids() AS my_group_ids)) AND ((athlete_id IS NULL) OR (athlete_id = ( SELECT auth.uid() AS uid)) OR (group_id IN ( SELECT my_coached_group_ids() AS my_coached_group_ids))) AND ((group_id IN ( SELECT my_coached_group_ids() AS my_coached_group_ids)) OR ((NOT ai_draft) AND (archived_at IS NULL) AND ((athlete_id IS NOT NULL) OR (NOT is_one_on_one_group(group_id))))))', false)),
      ('assign_program_to_client is exactly the expected function (0424)', coalesce((select md5(replace(pg_get_functiondef(p.oid), chr(13), '')) = '8f6b77c8a837bd090fbccc085b1d252a' from pg_proc p where p.oid = to_regprocedure('public.assign_program_to_client(uuid, uuid, uuid, text, date)')), false)),
      ('assign_program_to_client holds its hand-over check exactly once', coalesce((select (length(d) - length(replace(d, 'and not src.ai_draft', ''))) / length('and not src.ai_draft') = 1 from (select pg_get_functiondef(to_regprocedure('public.assign_program_to_client(uuid, uuid, uuid, text, date)')) as d) x), false))
  ) as checks(check_name, ok) where not ok;
  if failed is not null then
    raise exception 'Organization programs (the organization''s own programs: never followed, copied to a client or a group), step 187 (0435) cannot run: this step looks already applied, or the database is not in the state it expects. Failed checks: %. NOTHING was changed (the whole bundle is all or nothing). If an earlier step was applied by hand, use the single-step files for the rest, and send Spot this message.', failed;
  end if;
end
$g187$;

-- ====================================================================================================
-- migration 0435_org_programs.sql
-- ====================================================================================================

-- Organization programs (Oct 26; Ron: "i want programs tied to the org and assignable to client and group in the org" and "groups are different than clients. clients can go in groups
-- but not the other way around"; "the goal of groups is to assign 1 program to a large group of people").
-- An organization program is the organization's own: in its program library, never followed by anyone, only copied out (to a client, or to a group, where the copy is that group's program).
-- It keeps the org's anchor group as its technical home (every program table and rule is keyed by group), and is marked:
--  * programs.org_program (default false). Backfilled ONCE, when the column is first added: the 5 programs in the Collective (Enduring Strength Co.'s anchor group), by id. Every other
--    program stays its group's, including the programs of a team with no athletes yet (it is waiting for members, not a library).
--  * programs_select_members: a person who does not coach the group (a client) never reads an organization program (the condition is added to the part that applies to non-coaches).
--    Checked first: the live policy must be exactly the expected text, or nothing changes.
--  * assign_program_to_client: an organization program is never handed over to its first client (Ron chose: always copy); one condition is added to the hand-over check. Checked first:
--    the live function holds that check exactly once, or nothing changes.
-- Re-runnable.

do $col$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'programs' and column_name = 'org_program') then
    alter table public.programs add column org_program boolean not null default false;
    -- Only the organization's own programs, by name: the 5 in Enduring Strength Co.'s anchor group, the Collective (Ron: they are not the Collective's). A team with no athletes YET
    -- (the Trojans, The Home Team) is waiting for members: its programs are that team's and stay so.
    update public.programs
       set org_program = true
     where id in ('a6102694-0297-4142-b73f-e391649418be', '2738d78a-2b5f-4286-a249-adbedcf15459', '2143be95-1aa8-42a1-98f2-42c9b2b131bc', '4d029d91-cbb1-4a78-9e96-4f31c9263999', 'a117a12b-7ca3-4765-88cc-aae150585424')
       and group_id = '44444444-4444-4444-4444-444444444444'
       and athlete_id is null
       and archived_at is null;
  end if;
end
$col$;

do $pol$
declare
  v_qual text;
  v_old text := '((group_id IN ( SELECT my_group_ids() AS my_group_ids)) AND ((athlete_id IS NULL) OR (athlete_id = ( SELECT auth.uid() AS uid)) OR (group_id IN ( SELECT my_coached_group_ids() AS my_coached_group_ids))) AND ((group_id IN ( SELECT my_coached_group_ids() AS my_coached_group_ids)) OR ((NOT ai_draft) AND (archived_at IS NULL) AND ((athlete_id IS NOT NULL) OR (NOT is_one_on_one_group(group_id))))))';
begin
  select qual into v_qual from pg_policies where schemaname = 'public' and tablename = 'programs' and policyname = 'programs_select_members';
  if v_qual is null then
    raise exception 'programs_select_members was not found; NOTHING was changed.';
  end if;
  if position('org_program' in v_qual) > 0 then
    return; -- already changed (re-run)
  end if;
  if v_qual <> v_old then
    raise exception 'programs_select_members is not the expected text; NOTHING was changed.';
  end if;
  alter policy programs_select_members on public.programs using (
    (group_id in (select public.my_group_ids()))
    and ((athlete_id is null) or (athlete_id = (select auth.uid())) or (group_id in (select public.my_coached_group_ids())))
    and ((group_id in (select public.my_coached_group_ids())) or ((not ai_draft) and (not org_program) and (archived_at is null) and ((athlete_id is not null) or (not public.is_one_on_one_group(group_id)))))
  );
end
$pol$;

do $fn$
declare
  v_def text := pg_get_functiondef('public.assign_program_to_client(uuid, uuid, uuid, text, date)'::regprocedure);
  v_old text := 'and not src.ai_draft';
  v_new text := 'and not src.ai_draft and not src.org_program';
begin
  if position(v_new in v_def) > 0 then
    return; -- already changed (re-run)
  end if;
  if (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 1 then
    raise exception 'assign_program_to_client does not hold its hand-over check exactly once; NOTHING was changed.';
  end if;
  execute replace(v_def, v_old, v_new);
end
$fn$;

commit;

-- Read-only result (after the commit): every row must say in_place = true.
select step, what, in_place from (
  select 'step 187 (0435)' as step, '0435 Organization programs: a mark for the organization''s own programs' as what, not ((not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'programs' and column_name = 'org_program'))) as in_place
) as result order by step;
