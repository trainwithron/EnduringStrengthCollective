-- STEP 07: 0252 remove the plain-text kiosk PIN column (ONLY after the kiosk test passed)
--
-- !! Do NOT run this until supabase/ron-test-kiosk-checkin.md passed, and the live site's deployed code is at least commit 0019772 (it reads PINs through the hashed functions). After this the old column cannot be recovered except from a backup.
--
-- Run apply-precheck first (every row ok = true). Then paste THIS file and run it once.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."
-- AFTERWARDS: The plain-text PIN column no longer exists; check-in and PIN setting keep working through the hashed table.
-- ON ERROR: it is all or nothing, so nothing was applied. Run   rollback;   once, copy the red error text, and send it back. Do not run the file again.
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

-- ====================================================================================================
-- migration 0252_drop_plaintext_kiosk_pin.sql
-- ====================================================================================================

-- Remove the plain-text kiosk PIN column. APPLY THIS AFTER the new app code is deployed and 0251 is applied:
-- the previous code still reads group_memberships.kiosk_pin, so dropping it before the deploy would break that
-- screen. 0251 has already copied every PIN across hashed.
alter table public.group_memberships drop column if exists kiosk_pin;

commit;
