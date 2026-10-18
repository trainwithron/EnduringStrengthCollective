-- RELEASE B1 (SWITCH OFF AUTOMATIC NUTRITION SUGGESTIONS FOR ONE CLIENT; ADDS ONE COACH-ONLY TABLE, SAFE BEFORE THE CODE): ONE paste. Steps 160 in order, all or nothing.
--
-- Paste this whole file into the Supabase SQL editor and run it once. It replaces the separate precheck and apply files for these steps (they stay as the fallback).
-- Every check from each step's precheck is built in as a guard in front of that step. If any check is false, the run stops with a message that names the step and the
-- failed check, and NOTHING is kept, so a second run after a refusal is safe.
-- WHAT YOU SHOULD SEE: first "Success" for the transaction, then a result table with one row per step and in_place = true on every row.
-- ON ERROR: run   rollback;   once, copy the red text, send it to Spot. Do not run it again.
-- AFTER STEP 160: Nothing changes on screen until the Release B1 code is live. Adds one empty table (client_nutrition_flags) that only the group's coaches can read or write, and one small read function (nutrition_auto_off_state) that tells a coach only whether suggestions are off for their client. Until the code is live the weekly nutrition job behaves as before. Safe to run before the code.
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

-- ===== Release B1 (switch off automatic nutrition suggestions for one client; adds one coach-only table, safe before the code), step 160: 0408 Release B1: a coach can switch off automatic nutrition suggestions for one client (a coach-only note per client)
do $g160$
declare
  failed text;
begin
  select string_agg(check_name, '; ') into failed from (
    values
      ('0408 is not already applied (the flags table is not there yet)', to_regclass('public.client_nutrition_flags') is null),
      ('the tables and helper it uses exist', to_regclass('public.groups') is not null and to_regclass('public.profiles') is not null and to_regprocedure('public.is_group_coach(uuid)') is not null and to_regclass('public.group_memberships') is not null)
  ) as checks(check_name, ok) where not ok;
  if failed is not null then
    raise exception 'Release B1 (switch off automatic nutrition suggestions for one client; adds one coach-only table, safe before the code), step 160 (0408) cannot run: this step looks already applied, or the database is not in the state it expects. Failed checks: %. NOTHING was changed (the whole bundle is all or nothing). If an earlier step was applied by hand, use the single-step files for the rest, and send Spot this message.', failed;
  end if;
end
$g160$;

-- ====================================================================================================
-- migration 0408_client_nutrition_flags.sql
-- ====================================================================================================

-- Release B1: "No automatic nutrition suggestions" for one client.
--
-- Some clients' food and weight should only ever be approached by the coach, in person (an eating-disorder history, a recent injury or illness, a client who asked, a minor whose parent decides). For them
-- the weekly job that suggests a calorie or macro change must stay silent. The coach switches it on from the client's Nutrition tab. It lives in its own table that only the group's coaches can read or write,
-- NOT on the membership row, because the client reads their own membership and this note is for the coach alone. Taking a client out of the group and putting them back keeps it (it is not tied to the membership).
-- The switch follows the PERSON, not the group: the weekly job reads it for the person whichever group their check-in is in (a season rolled over, a move, a second coach's group).
-- The existing "No macros for [name]" switch (group_memberships.coach_sets_macros) also silences the job; this is the one that says "never, whatever the numbers are". Additions only. Re-runnable.
create table if not exists public.client_nutrition_flags (
  group_id uuid not null references public.groups(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  auto_off boolean not null default false,
  set_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (group_id, profile_id)
);

alter table public.client_nutrition_flags enable row level security;
revoke all on public.client_nutrition_flags from anon;
revoke truncate, references, trigger on public.client_nutrition_flags from authenticated;

drop policy if exists "client_nutrition_flags_coach_all" on public.client_nutrition_flags;
create policy "client_nutrition_flags_coach_all" on public.client_nutrition_flags for all
  to authenticated
  using (public.is_group_coach(group_id))
  -- the person must be a client of the group the coach is writing for (the switch follows the person into every group, so a coach must not be able to silence someone who is not theirs)
  with check (
    public.is_group_coach(group_id)
    and exists (select 1 from public.group_memberships gm where gm.group_id = client_nutrition_flags.group_id and gm.profile_id = client_nutrition_flags.profile_id and gm.role = 'athlete')
  );

do $$
begin
  if to_regprocedure('public.group_in_active_org(uuid)') is not null
     and not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'client_nutrition_flags' and policyname = 'org_wall_header') then
    create policy "org_wall_header" on public.client_nutrition_flags as restrictive for all to authenticated
      using (public.group_in_active_org(group_id)) with check (public.group_in_active_org(group_id));
  end if;
end
$$;

-- What a coach of the person's group is shown: is "no automatic suggestions" in force for this person? 'this' = switched on in this group; 'other' = switched on only in another of their groups (the weekly job still honours it);
-- 'none' = not on anywhere. It answers only that, and only to a coach of the group for a client of that group: never which coach set it, nor in which group.
create or replace function public.nutrition_auto_off_state(p_group uuid, p_profile uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.is_group_coach(p_group) then
    return 'none';
  end if;
  if not exists (select 1 from public.group_memberships gm where gm.group_id = p_group and gm.profile_id = p_profile and gm.role = 'athlete') then
    return 'none';
  end if;
  if exists (select 1 from public.client_nutrition_flags f where f.group_id = p_group and f.profile_id = p_profile and f.auto_off) then
    return 'this';
  end if;
  if exists (select 1 from public.client_nutrition_flags f where f.profile_id = p_profile and f.auto_off) then
    return 'other';
  end if;
  return 'none';
end;
$$;
revoke execute on function public.nutrition_auto_off_state(uuid, uuid) from public, anon;
grant execute on function public.nutrition_auto_off_state(uuid, uuid) to authenticated, service_role;

commit;

-- Read-only result (after the commit): every row must say in_place = true.
select step, what, in_place from (
  select 'step 160 (0408)' as step, '0408 Release B1: a coach can switch off automatic nutrition suggestions for one client' as what, not ((to_regclass('public.client_nutrition_flags') is null)) as in_place
) as result order by step;
