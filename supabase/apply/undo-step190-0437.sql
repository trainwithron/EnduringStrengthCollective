-- UNDO for step 190 (0437). Only if step 190 misbehaves, and only while the app update that goes with it is NOT live (it reads and writes these two columns). It removes the two settings, and any handle a coach saved with them.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."   Then tell Spot, and do not run the step again until Spot says why it failed.
begin;
alter table public.coach_booking_pages drop constraint if exists coach_booking_pages_instagram_handle_format;
alter table public.coach_booking_pages drop column if exists share_card_qr;
alter table public.coach_booking_pages drop column if exists instagram_handle;
commit;
