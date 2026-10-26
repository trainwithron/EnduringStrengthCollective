-- STEP 187: 0435 Organization programs: a mark for the organization's own programs (never followed by anyone, only copied to a client or a group), its backfill, one condition in the programs read rule and one in assign_program_to_client
--
-- !! This adds programs.org_program (default false) and, ONCE, marks the programs with no client, not archived, in a team or social group that has no clients (9 live programs on Oct 26, the Collective's 5 among them; the 3 in groups that have clients stay those groups' programs). It then adds ONE condition to programs_select_members (a person who does not coach the group never reads an organization program; the paste checks the live rule is exactly the expected text, and stops if not) and ONE to assign_program_to_client (an organization program is always copied to a client, never handed over; the paste checks the live function is exactly the expected one, and stops if not).
--
-- Run apply-precheck first (every row ok = true). Then paste THIS file and run it once.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."
-- AFTERWARDS: Nothing on screen changes until the app update that goes with it is deployed (deploy it right after). Then the organization's programs say only the organization at the top, Assign lists the organization's clients and its groups, and a client added to the Collective never gets the organization's programs.
-- ON ERROR: it is all or nothing, so nothing was applied. Run   rollback;   once, copy the red error text, and send it back. Do not run the file again.
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

do $guard$
begin
  if not ((not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'programs' and column_name = 'org_program'))) then
    raise exception 'Step 187 (0435) looks already applied, or the database is not in the state it expects. Nothing was changed. Run the precheck file and send Spot the result.';
  end if;
end
$guard$;

-- ====================================================================================================
-- migration 0435_org_programs.sql
-- ====================================================================================================

-- Organization programs (Oct 26; Ron: "i want programs tied to the org and assignable to client and group in the org" and "groups are different than clients. clients can go in groups
-- but not the other way around"; "the goal of groups is to assign 1 program to a large group of people").
-- An organization program is the organization's own: in its program library, never followed by anyone, only copied out (to a client, or to a group, where the copy is that group's program).
-- It keeps the org's anchor group as its technical home (every program table and rule is keyed by group), and is marked:
--  * programs.org_program (default false). Backfilled ONCE, when the column is first added: the programs with no client, not archived, in a team or social group that has no clients
--    (live, Oct 26: 9 programs, the Collective's 5 among them; the 3 in groups that have clients stay those groups' programs).
--  * programs_select_members: a person who does not coach the group (a client) never reads an organization program (the condition is added to the part that applies to non-coaches).
--    Checked first: the live policy must be exactly the expected text, or nothing changes.
--  * assign_program_to_client: an organization program is never handed over to its first client (Ron chose: always copy); one condition is added to the hand-over check. Checked first:
--    the live function holds that check exactly once, or nothing changes.
-- Re-runnable.

do $col$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'programs' and column_name = 'org_program') then
    alter table public.programs add column org_program boolean not null default false;
    update public.programs p
       set org_program = true
      from public.groups g
     where g.id = p.group_id
       and p.athlete_id is null
       and p.archived_at is null
       and g.group_kind in ('team', 'social')
       and not exists (select 1 from public.group_memberships m where m.group_id = g.id and m.role = 'athlete');
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
