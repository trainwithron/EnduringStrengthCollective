-- Release AY: the daily briefing is made once per coach, per day, PER ORGANIZATION. Until now a coach who runs two organizations got one briefing built from the clients of both at once (one request to the
-- AI naming clients from both, one shared limit of three items). The briefing row now records which organization it covers, so each organization's briefing is generated from that organization's clients only.
-- Additive: older rows keep an empty organization (they were whole-coach briefings), and the one-per-day rule still holds for them.
alter table public.coach_briefings add column if not exists organization_id uuid references public.organizations(id) on delete cascade;
alter table public.coach_briefings drop constraint if exists coach_briefings_coach_id_briefing_date_key;
create unique index if not exists coach_briefings_coach_day_org_key
  on public.coach_briefings (coach_id, briefing_date, coalesce(organization_id, '00000000-0000-0000-0000-000000000000'::uuid));
