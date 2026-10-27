-- SHARE PICTURES CARRY THE COACH (AN INSTAGRAM HANDLE AND A QR CODE TO THE COACH'S PUBLIC PAGE): ONE paste. Steps 190 in order, all or nothing.
--
-- Paste this whole file into the Supabase SQL editor and run it once. It replaces the separate precheck and apply files for these steps (they stay as the fallback).
-- Every check from each step's precheck is built in as a guard in front of that step. If any check is false, the run stops with a message that names the step and the
-- failed check, and NOTHING is kept, so a second run after a refusal is safe.
-- WHAT YOU SHOULD SEE: first "Success" for the transaction, then a result table with one row per step and in_place = true on every row.
-- ON ERROR: run   rollback;   once, copy the red text, send it to Spot. Do not run it again.
-- AFTER STEP 190: Nothing changes on screen until the app update that goes with it is deployed (deploy it right after): then a client's share picture carries a QR code to their coach's public page, and the Instagram handle once the coach sets one.
-- It contains no text searching, so editor re-indenting cannot break it.

begin;

-- ===== Share pictures carry the coach (an Instagram handle and a QR code to the coach's public page), step 190: 0437 Share pictures carry the coach: an Instagram handle and a QR-code switch on the coach's public page settings
do $g190$
declare
  failed text;
begin
  select string_agg(check_name, '; ') into failed from (
    values
      ('0437 is not already applied (coach_booking_pages has no instagram_handle yet)', not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'coach_booking_pages' and column_name = 'instagram_handle')),
      ('coach_booking_pages has no share_card_qr yet', not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'coach_booking_pages' and column_name = 'share_card_qr')),
      ('coach_booking_pages has its one row rule, coach_booking_pages_coach_manage (0330), and no other', (select count(*) from pg_policies where schemaname = 'public' and tablename = 'coach_booking_pages') = 1 and exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'coach_booking_pages' and policyname = 'coach_booking_pages_coach_manage'))
  ) as checks(check_name, ok) where not ok;
  if failed is not null then
    raise exception 'Share pictures carry the coach (an Instagram handle and a QR code to the coach''s public page), step 190 (0437) cannot run: this step looks already applied, or the database is not in the state it expects. Failed checks: %. NOTHING was changed (the whole bundle is all or nothing). If an earlier step was applied by hand, use the single-step files for the rest, and send Spot this message.', failed;
  end if;
end
$g190$;

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

-- Read-only result (after the commit): every row must say in_place = true.
select step, what, in_place from (
  select 'step 190 (0437)' as step, '0437 Share pictures carry the coach: an Instagram handle and a QR-code switch on the coach''s public page settings' as what, not ((not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'coach_booking_pages' and column_name = 'instagram_handle'))) as in_place
) as result order by step;
