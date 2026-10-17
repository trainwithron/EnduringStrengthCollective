-- STEP 138: HELD for Ron's word: require the health form and waiver of every client who has not finished one
--
-- !! DO NOT RUN until Ron says so. It changes what real clients see: each of them is sent to the health form the next time they open the app. Run check-intake-flag-list.sql first and read the names.
--
-- Run apply-precheck first (every row ok = true). Then paste THIS file and run it once.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."
-- AFTERWARDS: Every client who is not a coach anywhere and has no finished health form is asked to complete it the next time they open the app (before reaching anything else). Coaches, platform admins and clients who already finished are not touched. The people it flagged are listed in intake_flag_log so the undo can put exactly them back.
-- ON ERROR: it is all or nothing, so nothing was applied. Run   rollback;   once, copy the red error text, and send it back. Do not run the file again.
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

do $guard$
begin
  if not ((to_regclass('public.intake_flag_log') is null)) then
    raise exception 'Step 138 (flag-clients-without-intake) looks already applied, or the database is not in the state it expects. Nothing was changed. Run the precheck file and send Spot the result.';
  end if;
end
$guard$;

-- ====================================================================================================
-- flag-clients-without-intake: one-time data change
-- ====================================================================================================

create table if not exists public.intake_flag_log (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  flagged_at timestamptz not null default now()
);
alter table public.intake_flag_log enable row level security;
revoke all on public.intake_flag_log from anon, authenticated;
with flagged as (
  update public.profiles set intake_required = true
  where id in (select p.id from public.profiles p
where p.intake_required is not true
  and exists (select 1 from public.group_memberships gm where gm.profile_id = p.id and gm.role = 'athlete')
  and not exists (select 1 from public.group_memberships gm where gm.profile_id = p.id and gm.role = 'coach')
  and not exists (select 1 from public.client_intake ci where ci.athlete_id = p.id and ci.completed_at is not null)
  and not coalesce(p.is_platform_admin, false)
  and not exists (select 1 from public.group_memberships gx join public.groups gg on gg.id = gx.group_id where gx.profile_id = p.id and gg.organization_id = '50000000-0000-0000-0000-000000000001'))
  returning id
)
insert into public.intake_flag_log (profile_id) select id from flagged on conflict do nothing;

commit;
