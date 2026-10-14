-- UNDO for step 123 (0373). Only if step 123 misbehaves. Removes the pins and the saved card choices (the Progress tab then uses its defaults).
-- WHAT YOU SHOULD SEE: "Success. No rows returned."   Then tell Spot, and do not run the step again until Spot says why it failed.
begin;
drop function if exists public.client_daily_intake(uuid, uuid);
drop table if exists public.client_progress_pins;
drop table if exists public.coach_progress_prefs;
commit;
