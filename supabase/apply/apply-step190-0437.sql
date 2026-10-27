-- STEP 190: 0437 Share pictures carry the coach: an Instagram handle and a QR-code switch on the coach's public page settings
--
-- !! This adds two settings to coach_booking_pages: instagram_handle (none until a coach sets it; 1 to 30 letters, digits, "." and "_", stored without the @) and share_card_qr (on for every coach). Nothing else changes; row security is the table's existing rule.
--
-- Run apply-precheck first (every row ok = true). Then paste THIS file and run it once.
-- WHAT YOU SHOULD SEE: "Success. No rows returned."
-- AFTERWARDS: Nothing changes on screen until the app update that goes with it is deployed (deploy it right after): then a client's share picture carries a QR code to their coach's public page, and the Instagram handle once the coach sets one.
-- ON ERROR: it is all or nothing, so nothing was applied. Run   rollback;   once, copy the red error text, and send it back. Do not run the file again.
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

do $guard$
begin
  if not ((not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'coach_booking_pages' and column_name = 'instagram_handle'))) then
    raise exception 'Step 190 (0437) looks already applied, or the database is not in the state it expects. Nothing was changed. Run the precheck file and send Spot the result.';
  end if;
end
$guard$;

-- ====================================================================================================
-- migration 0437_share_card_qr_ig.sql
-- ====================================================================================================

-- Share pictures carry the coach (Ron, Oct 27: "Let's do QR code and IG handle"). Two settings on the coach's public page row, read by the share picture (lib/share-card-coach.ts):
--  * instagram_handle: the coach's Instagram handle, stored without the "@": 1 to 30 letters, digits, "." and "_" (Instagram's own rule), or none.
--  * share_card_qr: whether their clients' share pictures carry a QR code to the coach's public page (on by default; the code only shows while that page is switched on and published).
-- Row security is unchanged: the table's one rule already covers every column (only the coach reads and changes their own row; the public pages read through the server).
-- Re-runnable.

alter table public.coach_booking_pages
  add column if not exists instagram_handle text,
  add column if not exists share_card_qr boolean not null default true;

do $check$
begin
  if not exists (select 1 from pg_constraint where conname = 'coach_booking_pages_instagram_handle_format' and conrelid = 'public.coach_booking_pages'::regclass) then
    alter table public.coach_booking_pages
      add constraint coach_booking_pages_instagram_handle_format check (instagram_handle is null or instagram_handle ~ '^[A-Za-z0-9._]{1,30}$');
  end if;
end
$check$;

commit;
