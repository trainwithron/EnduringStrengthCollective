-- STEP 109: remove the two empty one-on-one groups named Rob Derrick left behind by the failed add-client attempts (both have no members, programs, sessions, posts or invites); undoable
--
-- !! A one-time data change that deletes exactly two EMPTY groups by id (e2425435-950a-409d-8d4e-e24d92f21652 and 568e84b6-b85c-476c-b160-7b6b64e21caa). It stops with nothing changed if either one has any member, program, session, post or invite.
--
-- Run apply-precheck first (every row ok = true). Then paste THIS file and run it once.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."
-- AFTERWARDS: The two stray Rob Derrick groups are gone. Nothing else changes. To see what was removed:  select row->>'id', row->>'name', row->>'created_at' from public.orphan_group_cleanup_log;
-- ON ERROR: it is all or nothing, so nothing was applied. Run   rollback;   once, copy the red error text, and send it back. Do not run the file again.
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

do $guard$
begin
  if not ((to_regclass('public.orphan_group_cleanup_log') is null)) then
    raise exception 'Step 109 (remove-empty-rob-derrick-groups) looks already applied, or the database is not in the state it expects. Nothing was changed. Run the precheck file and send Spot the result.';
  end if;
end
$guard$;

-- ====================================================================================================
-- remove-empty-rob-derrick-groups: one-time data change
-- ====================================================================================================

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
