-- RELEASE BO (REMOVES TWO EMPTY STRAY ROB DERRICK GROUPS; RUN ANY TIME): ONE paste. Steps 109 in order, all or nothing.
--
-- Paste this whole file into the Supabase SQL editor and run it once. It replaces the separate precheck and apply files for these steps (they stay as the fallback).
-- Every check from each step's precheck is built in as a guard in front of that step. If any check is false, the run stops with a message that names the step and the
-- failed check, and NOTHING is kept, so a second run after a refusal is safe.
-- WHAT YOU SHOULD SEE: first "Success" for the transaction, then a result table with one row per step and in_place = true on every row.
-- ON ERROR: run   rollback;   once, copy the red text, send it to Spot. Do not run it again.
-- AFTER STEP 109: The two stray Rob Derrick groups are gone. Nothing else changes. To see what was removed:  select row->>'id', row->>'name', row->>'created_at' from public.orphan_group_cleanup_log;
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

-- ===== Release BO (removes two empty stray Rob Derrick groups; run any time), step 109: remove the two empty one-on-one groups named Rob Derrick left behind by the failed add-client attempts (both have no members, programs, sessions, posts or invites); undoable
do $g109$
declare
  failed text;
begin
  select string_agg(check_name, '; ') into failed from (
    values
      ('both stray groups exist', (select count(*) from public.groups where id in ('e2425435-950a-409d-8d4e-e24d92f21652', '568e84b6-b85c-476c-b160-7b6b64e21caa') and name = 'Rob Derrick' and group_kind = 'one_on_one') = 2),
      ('neither has a member, program, session, post or invite', not exists (select 1 from public.group_memberships where group_id in ('e2425435-950a-409d-8d4e-e24d92f21652', '568e84b6-b85c-476c-b160-7b6b64e21caa')) and not exists (select 1 from public.programs where group_id in ('e2425435-950a-409d-8d4e-e24d92f21652', '568e84b6-b85c-476c-b160-7b6b64e21caa')) and not exists (select 1 from public.athlete_sessions where group_id in ('e2425435-950a-409d-8d4e-e24d92f21652', '568e84b6-b85c-476c-b160-7b6b64e21caa')) and not exists (select 1 from public.posts where group_id in ('e2425435-950a-409d-8d4e-e24d92f21652', '568e84b6-b85c-476c-b160-7b6b64e21caa')) and not exists (select 1 from public.group_invites where group_id in ('e2425435-950a-409d-8d4e-e24d92f21652', '568e84b6-b85c-476c-b160-7b6b64e21caa'))),
      ('step 109 is not already applied (the cleanup log is not there yet)', to_regclass('public.orphan_group_cleanup_log') is null)
  ) as checks(check_name, ok) where not ok;
  if failed is not null then
    raise exception 'Release BO (removes two empty stray Rob Derrick groups; run any time), step 109 (remove-empty-rob-derrick-groups) cannot run: this step looks already applied, or the database is not in the state it expects. Failed checks: %. NOTHING was changed (the whole bundle is all or nothing). If an earlier step was applied by hand, use the single-step files for the rest, and send Spot this message.', failed;
  end if;
end
$g109$;

create table public.orphan_group_cleanup_log (
  id bigserial primary key,
  row jsonb not null,
  cleaned_at timestamptz not null default now()
);
alter table public.orphan_group_cleanup_log enable row level security;
revoke all on public.orphan_group_cleanup_log from anon, authenticated;

do $clean$
declare
  v_ids constant uuid[] := array['e2425435-950a-409d-8d4e-e24d92f21652', '568e84b6-b85c-476c-b160-7b6b64e21caa']::uuid[];
begin
  if (select count(*) from public.groups where id = any (v_ids) and name = 'Rob Derrick' and group_kind = 'one_on_one') <> 2 then
    raise exception 'Expected exactly the two empty Rob Derrick groups.';
  end if;
  if exists (select 1 from public.group_memberships where group_id = any (v_ids))
     or exists (select 1 from public.programs where group_id = any (v_ids))
     or exists (select 1 from public.athlete_sessions where group_id = any (v_ids))
     or exists (select 1 from public.posts where group_id = any (v_ids))
     or exists (select 1 from public.group_invites where group_id = any (v_ids)) then
    raise exception 'One of the Rob Derrick groups is not empty; nothing was removed.';
  end if;
  insert into public.orphan_group_cleanup_log (row) select to_jsonb(g) from public.groups g where g.id = any (v_ids);
  delete from public.groups where id = any (v_ids);
end;
$clean$;

commit;

-- Read-only result (after the commit): every row must say in_place = true.
select step, what, in_place from (
  select 'step 109 (remove-empty-rob-derrick-groups)' as step, 'remove the two empty one-on-one groups named Rob Derrick left behind by the failed add-client attempts' as what, not ((to_regclass('public.orphan_group_cleanup_log') is null)) as in_place
) as result order by step;
