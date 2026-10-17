-- UNDO for step 144 (0392). Only if step 144 misbehaves. Run it only while the Release H code is not live (signup, Settings and Add client read the column and call the function). Removes the column and the function.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."   Then tell Spot, and do not run the step again until Spot says why it failed.
begin;
drop function if exists public.assign_group_coach(uuid, uuid, boolean);
alter table public.profiles drop column if exists coach_type;
commit;
