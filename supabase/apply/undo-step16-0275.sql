-- UNDO for step 16 (0275). Only if cancelling or moving a booking starts failing after step 16. Removes the trigger.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."   Then tell Spot, and do not run the step again until Spot says why it failed.
begin;
drop trigger if exists bookings_note_series_skip on public.bookings;
drop function if exists public.note_series_session_skipped();
commit;
