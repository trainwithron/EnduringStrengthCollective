-- STEP 62: 0317 A package can include access to a group: one optional column on packages (the group it opens) and one server-only record of the access a package gave, so it can end cleanly when a subscription lapses
--
-- Run apply-precheck first (every row ok = true). Then paste THIS file and run it once.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."
-- AFTERWARDS: Nothing changes for existing packages (none has a group). A coach can now pick a group on a package; a client who buys or is given it joins that group and sees its programs. If a subscription ends, the group access ends; the program copy stays and sessions follow their own expiry rule.
-- ON ERROR: it is all or nothing, so nothing was applied. Run   rollback;   once, copy the red error text, and send it back. Do not run the file again.
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

do $guard$
begin
  if not ((not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'coach_packages' and column_name = 'group_access_group_id'))) then
    raise exception 'Step 62 (0317) looks already applied, or the database is not in the state it expects. Nothing was changed. Run the precheck file and send Spot the result.';
  end if;
end
$guard$;

-- ====================================================================================================
-- migration 0317_package_group_access.sql
-- ====================================================================================================

-- Release T, part 2: a package can include ACCESS TO A GROUP (Ron). Buying or being given the package makes the client a member of that group, so they see its programs.
--
--   * coach_packages.group_access_group_id: nullable, the group the package opens (a group the coach coaches; checked by the server). Existing packages have none and behave as before.
--     Set to null if that group is ever deleted.
--   * package_group_access: one row per (client, group, package) recording the access a package gave, and whether the package is what made them a member (created_membership). It is how
--     the access can end cleanly when a subscription lapses without removing anyone who was already in the group by other means. Server only: no signed-in user can read or write it.
-- Nothing else changes. Re-runnable.

alter table public.coach_packages add column if not exists group_access_group_id uuid references public.groups(id) on delete set null;

create table if not exists public.package_group_access (
  athlete_id uuid not null references public.profiles(id) on delete cascade,
  group_id uuid not null references public.groups(id) on delete cascade,
  coach_package_id uuid not null references public.coach_packages(id) on delete cascade,
  created_membership boolean not null default false,
  granted_at timestamptz not null default now(),
  primary key (athlete_id, group_id, coach_package_id)
);
create index if not exists package_group_access_package_idx on public.package_group_access (coach_package_id);
alter table public.package_group_access enable row level security;
revoke all on public.package_group_access from anon, authenticated;

commit;
