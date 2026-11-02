-- UNDO step 198 (Kiosk modes and key cards). Removes the card numbers and the Kiosk mode; PINs and check-ins already made are kept.
drop function if exists public.kiosk_settings_roster(uuid);
drop function if exists public.card_check_in(uuid, text, uuid);
drop function if exists public.set_checkin_card(uuid, uuid, text);
drop function if exists public._may_manage_checkin_card(uuid, uuid);
drop table if exists public.checkin_cards;
drop function if exists public.set_kiosk_mode(uuid, text);
alter table public.groups drop constraint if exists groups_kiosk_mode_check;
alter table public.groups drop column if exists kiosk_mode;
