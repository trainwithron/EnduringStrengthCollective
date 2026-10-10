-- Release AL: a client chooses whether their FIRST NAME is shown on their shared workout pictures (the post-workout card and the picture they post). Default ON for everyone,
-- including under 18 (Ron's decision, 2026-10-10). One small column on profiles, next to preferred_share_background (0197). The public share page reads it on the server (with the
-- service role, like the rest of the card), so no new read rule is needed. It changes nothing for anyone until they switch it off.
-- New column only, nothing else touched.
alter table public.profiles add column if not exists show_name_on_share boolean not null default true;
