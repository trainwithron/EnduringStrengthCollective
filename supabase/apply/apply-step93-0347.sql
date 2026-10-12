-- STEP 93: 0347 The daily briefing is made once per coach, per day, per organization (a coach who runs two organizations no longer gets one briefing built from both)
--
-- Run apply-precheck first (every row ok = true). Then paste THIS file and run it once.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."
-- AFTERWARDS: Nothing visible changes today. From the next morning's run, a coach who runs more than one organization gets a separate briefing for each, built only from that organization's clients, and Home shows the open organization's. Earlier briefings are kept as they were. Run this BEFORE the code that goes with it is live.
-- ON ERROR: it is all or nothing, so nothing was applied. Run   rollback;   once, copy the red error text, and send it back. Do not run the file again.
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

do $guard$
begin
  if not ((not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'coach_briefings' and column_name = 'organization_id'))) then
    raise exception 'Step 93 (0347) looks already applied, or the database is not in the state it expects. Nothing was changed. Run the precheck file and send Spot the result.';
  end if;
end
$guard$;

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
