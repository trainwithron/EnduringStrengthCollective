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
