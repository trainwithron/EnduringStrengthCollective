-- HELD, RON'S WORD FIRST: REQUIRE THE HEALTH FORM AND WAIVER OF EVERY CLIENT WITHOUT ONE (READ CHECK-INTAKE-FLAG-LIST.SQL FIRST): ONE paste. Steps 138 in order, all or nothing.
--
-- Paste this whole file into the Supabase SQL editor and run it once. It replaces the separate precheck and apply files for these steps (they stay as the fallback).
-- Every check from each step's precheck is built in as a guard in front of that step. If any check is false, the run stops with a message that names the step and the
-- failed check, and NOTHING is kept, so a second run after a refusal is safe.
-- WHAT YOU SHOULD SEE: first "Success" for the transaction, then a result table with one row per step and in_place = true on every row.
-- ON ERROR: run   rollback;   once, copy the red text, send it to Spot. Do not run it again.
-- AFTER STEP 138: Every client who is not a coach anywhere and has no finished health form is asked to complete it the next time they open the app (before reaching anything else). Coaches, platform admins and clients who already finished are not touched. The people it flagged are listed in intake_flag_log so the undo can put exactly them back.
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

-- ===== HELD, Ron's word first: require the health form and waiver of every client without one (read check-intake-flag-list.sql first), step 138: HELD for Ron's word: require the health form and waiver of every client who has not finished one
do $g138$
declare
  failed text;
begin
  select string_agg(check_name, '; ') into failed from (
    values
      ('the column it sets exists', exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'intake_required')),
      ('the intake table exists', to_regclass('public.client_intake') is not null),
      ('step 138 is not already applied (the flag log is not there yet)', to_regclass('public.intake_flag_log') is null)
  ) as checks(check_name, ok) where not ok;
  if failed is not null then
    raise exception 'HELD, Ron''s word first: require the health form and waiver of every client without one (read check-intake-flag-list.sql first), step 138 (flag-clients-without-intake) cannot run: this step looks already applied, or the database is not in the state it expects. Failed checks: %. NOTHING was changed (the whole bundle is all or nothing). If an earlier step was applied by hand, use the single-step files for the rest, and send Spot this message.', failed;
  end if;
end
$g138$;

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
  and not exists (select 1 from public.organization_memberships om where om.profile_id = p.id and om.role in ('owner', 'admin'))
  and not exists (select 1 from public.group_memberships gx join public.groups gg on gg.id = gx.group_id where gx.profile_id = p.id and gg.organization_id = '50000000-0000-0000-0000-000000000001'))
  returning id
)
insert into public.intake_flag_log (profile_id) select id from flagged on conflict do nothing;

commit;

-- Read-only result (after the commit): every row must say in_place = true.
select step, what, in_place from (
  select 'step 138 (flag-clients-without-intake)' as step, 'HELD for Ron''s word: require the health form and waiver of every client who has not finished one' as what, not ((to_regclass('public.intake_flag_log') is null)) as in_place
) as result order by step;
