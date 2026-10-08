-- UNDO for step 58 (0313). Only if step 58 misbehaves. Removes the function and its index; the app then counts the old way (reading the open sessions), which is slower for very large rosters but gives the same numbers.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."   Then tell Spot, and do not run the step again until Spot says why it failed.
begin;
drop function if exists public.booking_counts(uuid, uuid, uuid[], uuid);
drop index if exists public.bookings_open_counts_idx;
commit;
