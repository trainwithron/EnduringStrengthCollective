-- UNDO for step 153 (0401). Only if step 153 misbehaves. Run it only while the Release U1 code is not live. Removes the graduation years that were entered, the record of who was emailed and the new function; the app goes back to calling start_new_season directly (the old code still does).
-- WHAT YOU SHOULD SEE: "Success. No rows returned."   Then tell Spot, and do not run the step again until Spot says why it failed.
begin;
drop function if exists public.start_next_season(uuid, text, uuid[], int);
alter table public.groups drop column if exists graduates_through;
drop table if exists public.graduation_exports;
alter table public.group_memberships drop constraint if exists group_memberships_graduation_year_range;
alter table public.group_memberships drop column if exists graduation_year;
commit;
