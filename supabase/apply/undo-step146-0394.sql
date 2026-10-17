-- UNDO for step 146 (0394). Only if step 146 misbehaves. Run it only while the Release J code is not live (the coach's group lists, where people land and the Team page read the column). Seasons already started stay; the retired groups come back into every list.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."   Then tell Spot, and do not run the step again until Spot says why it failed.
begin;
drop function if exists public.unarchive_group(uuid);
drop function if exists public.start_new_season(uuid, text, uuid[]);
alter table public.groups drop column if exists archived_at;
commit;
