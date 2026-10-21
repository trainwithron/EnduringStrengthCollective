-- UNDO for step 183 (0431). Only if step 183 misbehaves, and only while the Add a passage app update is NOT live. It removes the table AND every passage coaches have added (the app then shows only the bundled passages).
-- WHAT YOU SHOULD SEE: "Success. No rows returned."   Then tell Spot, and do not run the step again until Spot says why it failed.
begin;
drop table if exists public.coach_read_passages;
commit;
