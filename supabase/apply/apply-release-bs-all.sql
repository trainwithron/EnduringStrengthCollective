-- RELEASE BS (SMALLER GOALS UNDER A CLIENT'S GOAL; RUN BEFORE THE CODE THAT GOES WITH IT IS LIVE): ONE paste. Steps 113 in order, all or nothing.
--
-- Paste this whole file into the Supabase SQL editor and run it once. It replaces the separate precheck and apply files for these steps (they stay as the fallback).
-- Every check from each step's precheck is built in as a guard in front of that step. If any check is false, the run stops with a message that names the step and the
-- failed check, and NOTHING is kept, so a second run after a refusal is safe.
-- WHAT YOU SHOULD SEE: first "Success" for the transaction, then a result table with one row per step and in_place = true on every row.
-- ON ERROR: run   rollback;   once, copy the red text, send it to Spot. Do not run it again.
-- AFTER STEP 113: Nothing changes on screen until the code that goes with it is live. Then the client's My Goal page and the coach's view of the client show a Smaller goals section. Changing a state goes through the server only.
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

-- ===== Release BS (smaller goals under a client's goal; run BEFORE the code that goes with it is live), step 113: 0363 Smaller goals under a client's goal: either side adds one, the other side agrees or says not now, an agreed one can be marked done (nothing changes a program or a nutrition target)
do $g113$
declare
  failed text;
begin
  select string_agg(check_name, '; ') into failed from (
    values
      ('0363 is not already applied (the smaller-goals table does not exist yet)', to_regclass('public.client_sub_goals') is null),
      ('the goals table and the group helpers exist', to_regclass('public.client_goals') is not null and to_regprocedure('public.is_group_coach(uuid)') is not null)
  ) as checks(check_name, ok) where not ok;
  if failed is not null then
    raise exception 'Release BS (smaller goals under a client''s goal; run BEFORE the code that goes with it is live), step 113 (0363) cannot run: this step looks already applied, or the database is not in the state it expects. Failed checks: %. NOTHING was changed (the whole bundle is all or nothing). If an earlier step was applied by hand, use the single-step files for the rest, and send Spot this message.', failed;
  end if;
end
$g113$;

-- ====================================================================================================
-- migration 0363_client_sub_goals.sql
-- ====================================================================================================

-- Release BS: smaller goals under a client's goal. Either the client or their coach adds one (a title and an optional date: "Deadlift 315 by Nov 30"); the OTHER side agrees or says not now; once agreed, either side can mark it done.
-- Nothing here changes a program or a nutrition target. The people involved read them (the client, and the coaches of the group); adding is limited to the client for themselves or a coach for a client of their
-- group; changing the state (agree, not now, done) is done only by the server, which checks who is asking, so there is no update or delete right for signed-in people. Like every table of group content it carries
-- the organization-wall rule when that is installed.
create table public.client_sub_goals (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references public.profiles(id) on delete cascade,
  group_id uuid not null references public.groups(id) on delete cascade,
  goal_id uuid references public.client_goals(id) on delete set null,
  title text not null check (char_length(btrim(title)) between 1 and 120),
  target_date date,
  proposed_by uuid not null references public.profiles(id),
  status text not null default 'proposed' check (status in ('proposed', 'agreed', 'declined', 'done')),
  responded_by uuid references public.profiles(id),
  responded_at timestamptz,
  done_at timestamptz,
  created_at timestamptz not null default now()
);
create index client_sub_goals_athlete_idx on public.client_sub_goals (athlete_id, group_id);

alter table public.client_sub_goals enable row level security;
revoke all on public.client_sub_goals from anon;
revoke update, delete, truncate on public.client_sub_goals from authenticated;

create policy "client_sub_goals_read" on public.client_sub_goals for select to authenticated
  using (athlete_id = (select auth.uid()) or public.is_group_coach(group_id));
create policy "client_sub_goals_add" on public.client_sub_goals for insert to authenticated
  with check (
    proposed_by = (select auth.uid())
    and status = 'proposed'
    and responded_by is null
    and (
      athlete_id = (select auth.uid())
      or (public.is_group_coach(group_id) and exists (select 1 from public.group_memberships gm where gm.group_id = client_sub_goals.group_id and gm.profile_id = client_sub_goals.athlete_id and gm.role = 'athlete'))
    )
    and exists (select 1 from public.group_memberships gm2 where gm2.group_id = client_sub_goals.group_id and gm2.profile_id = client_sub_goals.athlete_id)
  );

do $$
begin
  if to_regprocedure('public.group_in_active_org(uuid)') is not null then
    create policy "org_wall_header" on public.client_sub_goals as restrictive for all to authenticated
      using (public.group_in_active_org(group_id)) with check (public.group_in_active_org(group_id));
  end if;
end
$$;

commit;

-- Read-only result (after the commit): every row must say in_place = true.
select step, what, in_place from (
  select 'step 113 (0363)' as step, '0363 Smaller goals under a client''s goal: either side adds one' as what, not ((to_regclass('public.client_sub_goals') is null)) as in_place
) as result order by step;
