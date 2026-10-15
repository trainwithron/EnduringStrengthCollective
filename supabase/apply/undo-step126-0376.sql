-- UNDO for step 126 (0376). Only if step 126 misbehaves. Removes the saved number (the line then shows again for every client with a flagged answer).
-- WHAT YOU SHOULD SEE: "Success. No rows returned."   Then tell Spot, and do not run the step again until Spot says why it failed.
begin;
alter table public.athlete_injury_flag_acknowledgements drop column if exists flagged_count;
commit;
