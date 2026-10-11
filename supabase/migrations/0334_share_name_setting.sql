-- Release AL: a client chooses whether their FIRST NAME is shown on their shared workout pictures (the post-workout card and the picture they post). One small column on profiles,
-- next to preferred_share_background (0197). The public share page reads it on the server (with the service role, like the rest of the card), so no new read rule is needed.
-- The column starts EMPTY (null = "has not chosen"): the app then shows the name for an adult and leaves it off for a client under 18, from the date of birth on their intake form;
-- a client who switches it on or off in Settings (true or false) always decides for themselves. Nothing needs filling in for anyone already in the app.
-- New column only, nothing else touched.
alter table public.profiles add column if not exists show_name_on_share boolean;
