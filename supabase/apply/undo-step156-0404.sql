-- UNDO for step 156 (0404). Only if step 156 misbehaves. Run it only while the Release X1 code is not live (the code then falls back to the older read on its own).
-- WHAT YOU SHOULD SEE: "Success. No rows returned."   Then tell Spot, and do not run the step again until Spot says why it failed.
begin;
drop function if exists public.group_position_roster(uuid);
drop function if exists public.group_member_names(uuid);
commit;
