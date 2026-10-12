-- RELEASE AY (THE DAILY BRIEFING IS MADE PER ORGANIZATION; RUN BEFORE THE CODE THAT GOES WITH IT IS LIVE): ONE paste. Steps 93 in order, all or nothing.
--
-- Paste this whole file into the Supabase SQL editor and run it once. It replaces the separate precheck and apply files for these steps (they stay as the fallback).
-- Every check from each step's precheck is built in as a guard in front of that step. If any check is false, the run stops with a message that names the step and the
-- failed check, and NOTHING is kept, so a second run after a refusal is safe.
-- WHAT YOU SHOULD SEE: first "Success" for the transaction, then a result table with one row per step and in_place = true on every row.
-- ON ERROR: run   rollback;   once, copy the red text, send it to Spot. Do not run it again.
-- AFTER STEP 93: Nothing visible changes today. From the next morning's run, a coach who runs more than one organization gets a separate briefing for each, built only from that organization's clients, and Home shows the open organization's. Earlier briefings are kept as they were. Run this BEFORE the code that goes with it is live.
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

-- ===== Release AY (the daily briefing is made per organization; run BEFORE the code that goes with it is live), step 93: 0347 The daily briefing is made once per coach, per day, per organization (a coach who runs two organizations no longer gets one briefing built from both)
do $g93$
declare
  failed text;
begin
  select string_agg(check_name, '; ') into failed from (
    values
      ('0347 is not already applied (the briefing has no organization column yet)', not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'coach_briefings' and column_name = 'organization_id')),
      ('the briefing table exists', to_regclass('public.coach_briefings') is not null)
  ) as checks(check_name, ok) where not ok;
  if failed is not null then
    raise exception 'Release AY (the daily briefing is made per organization; run BEFORE the code that goes with it is live), step 93 (0347) cannot run: this step looks already applied, or the database is not in the state it expects. Failed checks: %. NOTHING was changed (the whole bundle is all or nothing). If an earlier step was applied by hand, use the single-step files for the rest, and send Spot this message.', failed;
  end if;
end
$g93$;

-- ====================================================================================================
-- migration 0347_briefing_per_organization.sql
-- ====================================================================================================

-- Release AY: the daily briefing is made once per coach, per day, PER ORGANIZATION. Until now a coach who runs two organizations got one briefing built from the clients of both at once (one request to the
-- AI naming clients from both, one shared limit of three items). The briefing row now records which organization it covers, so each organization's briefing is generated from that organization's clients only.
-- Additive: older rows keep an empty organization (they were whole-coach briefings), and the one-per-day rule still holds for them.
alter table public.coach_briefings add column if not exists organization_id uuid references public.organizations(id) on delete cascade;
alter table public.coach_briefings drop constraint if exists coach_briefings_coach_id_briefing_date_key;
create unique index if not exists coach_briefings_coach_day_org_key
  on public.coach_briefings (coach_id, briefing_date, coalesce(organization_id, '00000000-0000-0000-0000-000000000000'::uuid));

commit;

-- Read-only result (after the commit): every row must say in_place = true.
select step, what, in_place from (
  select 'step 93 (0347)' as step, '0347 The daily briefing is made once per coach' as what, not ((not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'coach_briefings' and column_name = 'organization_id'))) as in_place
) as result order by step;
