-- Video chat for 1-on-1 bookings (webrtc_video_provider_comparison
-- memory — Daily.co, prebuilt embed). Extends the existing bookings
-- table with a session-type distinction rather than a parallel
-- scheduling system, per the original scoping. Null provider/room_name
-- (every existing and most new bookings) means a plain in-person
-- session, unchanged from today; a coach or athlete opts a specific
-- booking into video by setting session_type.
alter table public.bookings
  add column session_type text not null default 'in_person'
    check (session_type in ('in_person', 'video')),
  add column video_provider text,
  add column video_room_name text;
