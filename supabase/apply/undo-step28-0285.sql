-- UNDO for step 28 (0285). Only if the record misbehaves after step 28. Removes the record of sent nudges; the nightly job then sends no rest-day nudges until the table is back.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."   Then tell Spot, and do not run the step again until Spot says why it failed.
begin;
drop table if exists public.rest_day_nudges;
commit;
