-- RELEASE AV (A COACH CAN STILL TIDY UP AN EXISTING ROW OF SOMEONE WHO LEFT THE GROUP; RUN AFTER RELEASE AR): ONE paste. Steps 90 in order, all or nothing.
--
-- Paste this whole file into the Supabase SQL editor and run it once. It replaces the separate precheck and apply files for these steps (they stay as the fallback).
-- Every check from each step's precheck is built in as a guard in front of that step. If any check is false, the run stops with a message that names the step and the
-- failed check, and NOTHING is kept, so a second run after a refusal is safe.
-- WHAT YOU SHOULD SEE: first "Success" for the transaction, then a result table with one row per step and in_place = true on every row.
-- ON ERROR: run   rollback;   once, copy the red text, send it to Spot. Do not run it again.
-- AFTER STEP 90: Nothing changes for normal use. A coach refunding or settling a session for a client who has since left the group no longer gets 'That person is not a member of this group'. A first row about someone who never belonged to the group is still refused. Run AFTER Release AR.
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

-- ===== Release AV (a coach can still tidy up an existing row of someone who left the group; run AFTER Release AR), step 90: 0344 The 'person must belong to the group' rule still lets a coach tidy up an existing row of someone who has since left (refunds and settlements)
do $g90$
declare
  failed text;
begin
  select string_agg(check_name, '; ') into failed from (
    values
      ('0344 is not already applied (the rule has no exception for existing rows yet)', to_regprocedure('public.enforce_athlete_in_group()') is not null and position('v_had_row' in pg_get_functiondef(to_regprocedure('public.enforce_athlete_in_group()'))) = 0),
      ('Release AR is applied (the rule exists)', to_regprocedure('public.enforce_athlete_in_group()') is not null)
  ) as checks(check_name, ok) where not ok;
  if failed is not null then
    raise exception 'Release AV (a coach can still tidy up an existing row of someone who left the group; run AFTER Release AR), step 90 (0344) cannot run: this step looks already applied, or the database is not in the state it expects. Failed checks: %. NOTHING was changed (the whole bundle is all or nothing). If an earlier step was applied by hand, use the single-step files for the rest, and send Spot this message.', failed;
  end if;
end
$g90$;

-- ====================================================================================================
-- migration 0344_athlete_in_group_keep_old_rows.sql
-- ====================================================================================================

-- Release AV: follow-up to the athlete-in-group rule (0340). A row that already exists for this person in this group may still be written by its coach after the person has LEFT the group
-- (for example a refund or settlement that is an "insert ... on conflict do update" on session_credits: the database runs the insert-time check even when the insert turns into an update).
-- The rule still refuses a row about someone who has NEVER belonged to the group, which is the whole point: planting a first row needs a membership. Same function name; nothing else changes.

create or replace function public.enforce_athlete_in_group()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_athlete uuid := nullif(to_jsonb(new)->>'athlete_id', '')::uuid;
  v_group uuid := nullif(to_jsonb(new)->>'group_id', '')::uuid;
  v_had_row boolean;
begin
  -- Only a signed-in person's own request is checked. The server (service role), definer jobs run by the database and migrations are not.
  if coalesce(auth.role(), '') <> 'authenticated' then
    return new;
  end if;
  if v_athlete is null or v_group is null then
    return new;
  end if;
  if tg_op = 'UPDATE'
     and v_athlete is not distinct from nullif(to_jsonb(old)->>'athlete_id', '')::uuid
     and v_group is not distinct from nullif(to_jsonb(old)->>'group_id', '')::uuid then
    return new;
  end if;
  if exists (select 1 from public.group_memberships gm where gm.group_id = v_group and gm.profile_id = v_athlete) then
    return new;
  end if;
  -- Not a member now: allowed only when this table already holds a row for this person in this group (they were here once; this is the coach tidying up after them).
  if tg_op = 'INSERT' then
    execute format('select exists (select 1 from %I.%I where athlete_id = $1 and group_id = $2)', tg_table_schema, tg_table_name)
      into v_had_row using v_athlete, v_group;
    if v_had_row then
      return new;
    end if;
  end if;
  raise exception 'That person is not a member of this group.' using errcode = '42501';
end;
$$;
revoke execute on function public.enforce_athlete_in_group() from public, anon, authenticated;

commit;

-- Read-only result (after the commit): every row must say in_place = true.
select step, what, in_place from (
  select 'step 90 (0344)' as step, '0344 The ''person must belong to the group'' rule still lets a coach tidy up an existing row of someone who has since left' as what, not ((to_regprocedure('public.enforce_athlete_in_group()') is not null and position('v_had_row' in pg_get_functiondef(to_regprocedure('public.enforce_athlete_in_group()'))) = 0)) as in_place
) as result order by step;
