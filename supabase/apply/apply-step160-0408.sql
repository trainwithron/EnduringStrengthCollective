-- STEP 160: 0408 Release B1: a coach can switch off automatic nutrition suggestions for one client (a coach-only note per client)
--
-- Run apply-precheck first (every row ok = true). Then paste THIS file and run it once.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."
-- AFTERWARDS: Nothing changes on screen until the Release B1 code is live. Adds one empty table (client_nutrition_flags) that only the group's coaches can read or write, and one small read function (nutrition_auto_off_state) that tells a coach only whether suggestions are off for their client. Until the code is live the weekly nutrition job behaves as before. Safe to run before the code.
-- ON ERROR: it is all or nothing, so nothing was applied. Run   rollback;   once, copy the red error text, and send it back. Do not run the file again.
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

do $guard$
begin
  if not ((to_regclass('public.client_nutrition_flags') is null)) then
    raise exception 'Step 160 (0408) looks already applied, or the database is not in the state it expects. Nothing was changed. Run the precheck file and send Spot the result.';
  end if;
end
$guard$;

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
  -- to SWITCH IT ON the person must be a client of the group the coach is writing for (the switch follows the person into every group, so a coach must not be able to silence someone who is not theirs);
  -- the coach of the group where it was set can always SWITCH IT OFF, even after the client has left that group, so it can never be stuck on with nobody able to clear it
  with check (
    public.is_group_coach(group_id)
    and (
      auto_off = false
      or exists (select 1 from public.group_memberships gm where gm.group_id = client_nutrition_flags.group_id and gm.profile_id = client_nutrition_flags.profile_id and gm.role = 'athlete')
    )
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
