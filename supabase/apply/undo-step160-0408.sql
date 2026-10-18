-- UNDO for step 160 (0408). Only if step 160 misbehaves. Run it only while the Release B1 code is not live, and be aware that dropping it forgets which clients had suggestions switched off (the weekly job would suggest for them again).
-- WHAT YOU SHOULD SEE: "Success. No rows returned."   Then tell Spot, and do not run the step again until Spot says why it failed.
begin;
drop function if exists public.nutrition_auto_off_state(uuid, uuid);
drop table if exists public.client_nutrition_flags;
commit;
