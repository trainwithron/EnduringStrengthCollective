-- UNDO for step 93 (0347). Only if step 93 misbehaves, and only BEFORE the new code has made two briefings for one coach on one day (the undo then stops with an error and changes nothing). Puts back the one-per-coach-per-day rule and removes the organization column.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."   Then tell Spot, and do not run the step again until Spot says why it failed.
begin;
create unique index if not exists coach_briefings_coach_id_briefing_date_key_undo on public.coach_briefings (coach_id, briefing_date);
drop index if exists public.coach_briefings_coach_id_briefing_date_key_undo;
drop index if exists public.coach_briefings_coach_day_org_key;
alter table public.coach_briefings add constraint coach_briefings_coach_id_briefing_date_key unique (coach_id, briefing_date);
alter table public.coach_briefings drop column if exists organization_id;
commit;
