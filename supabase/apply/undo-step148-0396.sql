-- UNDO for step 148 (0396). Only if step 148 misbehaves. Run it only while the Release L code is not live (the Team page and Settings read the column). Coaches already marked leaving lose the mark but keep everything they kept.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."   Then tell Spot, and do not run the step again until Spot says why it failed.
begin;
drop function if exists public.complete_departure(uuid, uuid);
alter table public.organization_memberships drop column if exists departing_since;
-- then run step 143 (0391) again to bring back the earlier remove / leave / close behavior
commit;
