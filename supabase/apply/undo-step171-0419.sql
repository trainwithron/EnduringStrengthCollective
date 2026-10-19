-- UNDO for step 171 (0419). Only if step 171 misbehaves, and only before anyone has saved an upload: workouts an upload already saved stay (undo them from the app first). The new notice kind is left in the list; it is harmless.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."   Then tell Spot, and do not run the step again until Spot says why it failed.
begin;
drop function if exists public.team_sheet_undo(uuid);
drop function if exists public.team_sheet_fix_record(uuid, text, text);
drop function if exists public.team_sheet_save(uuid, text, jsonb, boolean, uuid, boolean);
drop table if exists public.team_sheet_batches;
commit;
